#!/bin/sh
# Lancer depuis un fichier situe hors du dossier de l'installation :
# sudo sh /volume1/docker/METTRE-A-JOUR-SYNOLOGY.sh /volume1/docker/myhomeia-synology.zip
set -eu
umask 077

installation=${MYHOMEIA_DIR:-/volume1/docker/myhomeia}
backup_root=${MYHOMEIA_BACKUP_DIR:-/volume1/docker/myhomeia-backups}
package=${1:-/volume1/docker/myhomeia-synology.zip}
container=myhomeia
staging=
temporary_root=
backup=
backup_complete=0
lock_owned=0
container_stopped=0
was_running=false
installation_changed=0
compose_mode=

fail() {
    printf 'Erreur : %s\n' "$*" >&2
    exit 1
}

compose() {
    if [ "$compose_mode" = plugin ]; then
        docker compose "$@"
    else
        docker-compose "$@"
    fi
}

cleanup() {
    result=$?
    trap - 0 HUP INT TERM
    if [ "$result" -ne 0 ]; then
        printf '\nLa mise a jour a echoue.\n' >&2
        if [ "$backup_complete" -eq 1 ]; then
            printf 'Sauvegarde conservee : %s\n' "$backup" >&2
        elif [ -n "$backup" ]; then
            printf 'Sauvegarde incomplete, ne pas la restaurer : %s\n' "$backup" >&2
        fi
        # Avant le remplacement des sources, les donnees sont encore intactes.
        if [ "$container_stopped" -eq 1 ] && [ "$installation_changed" -eq 0 ] && [ "$was_running" = true ]; then
            printf 'Redemarrage du conteneur existant...\n' >&2
            docker start "$container" >&2 || printf 'Le redemarrage a echoue. Verifiez le conteneur dans Container Manager.\n' >&2
        elif [ "$installation_changed" -eq 1 ]; then
            printf 'Verifiez le conteneur dans Container Manager avant toute restauration.\n' >&2
            printf 'Diagnostic : docker logs --tail=100 %s\n' "$container" >&2
        fi
    fi
    if [ -n "$staging" ] && [ -n "$temporary_root" ]; then
        case "$staging" in
            "$temporary_root"/myhomeia-update.*) rm -rf "$staging" || : ;;
        esac
    fi
    if [ "$lock_owned" -eq 1 ]; then
        rmdir "$installation/.myhomeia-update.lock" 2>/dev/null || :
    fi
    exit "$result"
}
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[ "$#" -le 1 ] || fail "Utilisation : sudo sh $0 [chemin/myhomeia-synology.zip]"
[ "$(id -u)" -eq 0 ] || fail "Lancez ce script avec sudo sh $0 [chemin du ZIP]."

# Le PATH standard de sudo sur DSM ne contient pas toujours Docker.
PATH="$PATH:/usr/local/bin:/usr/bin:/bin:/var/packages/ContainerManager/target/usr/bin"
export PATH
for required in docker 7z cp mv mkdir mktemp date sleep rm rmdir; do
    command -v "$required" >/dev/null 2>&1 || fail "Commande introuvable : $required"
done
[ -d "$installation" ] || fail "Installation introuvable : $installation"
installation=$(cd "$installation" && pwd -P)
[ "$installation" != / ] || fail "Le dossier d'installation ne peut pas etre la racine."
[ -f "$installation/.env" ] && [ ! -L "$installation/.env" ] || fail "Le fichier .env doit exister et ne pas etre un lien symbolique."
[ -d "$installation/data" ] && [ ! -L "$installation/data" ] || fail "Le repertoire data doit exister et ne pas etre un lien symbolique."
if [ -L "$installation/app" ] || { [ -f "$installation/app" ] && [ ! -d "$installation/app" ]; }; then
    fail "Le dossier app de l'installation doit etre un repertoire ordinaire."
fi
[ -f "$package" ] || fail "Package introuvable : $package"
package=$(cd "$(dirname "$package")" && printf '%s/%s\n' "$(pwd -P)" "$(basename "$package")")
script=$(cd "$(dirname "$0")" && printf '%s/%s\n' "$(pwd -P)" "$(basename "$0")")
case "$script" in
    "$installation"/*) fail "Placez le script hors de $installation, par exemple dans /volume1/docker/." ;;
esac

if docker compose version >/dev/null 2>&1; then
    compose_mode=plugin
elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    compose_mode=legacy
else
    fail "Docker Compose est indisponible. Verifiez Container Manager."
fi

projet=$(docker inspect --format '{{with index .Config.Labels "com.docker.compose.project"}}{{.}}{{end}}' "$container")
service=$(docker inspect --format '{{with index .Config.Labels "com.docker.compose.service"}}{{.}}{{end}}' "$container")
[ -n "$projet" ] && [ "$service" = myhomeia ] || fail "Projet ou service inattendu : projet=$projet service=$service. Le conteneur est conserve."
data_source=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' "$container")
[ -n "$data_source" ] && [ -d "$data_source" ] || fail "Le volume /app/data du conteneur est introuvable."
data_source=$(cd "$data_source" && pwd -P)
expected_data=$(cd "$installation/data" && pwd -P)
[ "$data_source" = "$expected_data" ] || fail "Le conteneur utilise $data_source, mais cette installation utilise $expected_data. Aucune mise a jour effectuee."

mkdir -p "$backup_root"
backup_root=$(cd "$backup_root" && pwd -P)
case "$backup_root/" in
    "$installation/"*) fail "Les sauvegardes doivent etre hors du dossier d'installation." ;;
esac
temporary_root=$(cd "${TMPDIR:-/tmp}" && pwd -P)
case "$temporary_root/" in
    "$installation/"*) fail "Le dossier temporaire doit etre hors du dossier d'installation." ;;
esac
if ! mkdir "$installation/.myhomeia-update.lock" 2>/dev/null; then
    fail "Une mise a jour est deja en cours (.myhomeia-update.lock)."
fi
lock_owned=1
staging=$(mktemp -d "$temporary_root/myhomeia-update.XXXXXX")

printf 'Verification du package...\n'
# L'extraction preliminaire verifie aussi les CRC, avant tout arret du service.
7z x "$package" -o"$staging"
for required in Dockerfile docker-compose.yml .dockerignore app/package.json app/package-lock.json app/scripts/nas-entrypoint.mjs; do
    [ -f "$staging/$required" ] || fail "Package incomplet : $required manque a sa racine."
done
for protected in "$staging/data" "$staging/app/data" "$staging"/.env* "$staging/app"/.env*; do
    case "$protected" in
        "$staging/.env.example"|"$staging/app/.env.example") continue ;;
    esac
    if [ -f "$protected" ] || [ -d "$protected" ] || [ -L "$protected" ]; then
        fail "Le package ne doit pas contenir data/ ni de fichier .env personnel."
    fi
done
compose --env-file "$installation/.env" -f "$staging/docker-compose.yml" -p "$projet" config --quiet
was_running=$(docker inspect --format '{{.State.Running}}' "$container")
case "$was_running" in true|false) ;; *) fail "Etat du conteneur inattendu : $was_running" ;; esac

printf 'Arret du conteneur %s (projet %s)...\n' "$container" "$projet"
docker stop -t 30 "$container"
container_stopped=1
[ "$(docker inspect --format '{{.State.Running}}' "$container")" = false ] || fail "Le conteneur doit etre arrete avant de sauvegarder SQLite."

backup="$backup_root/$(date '+%Y%m%d-%H%M%S')-$$"
mkdir -m 700 "$backup"
printf 'Sauvegarde de .env et data/ dans %s...\n' "$backup"
cp -a "$installation/.env" "$backup/.env"
cp -a "$installation/data" "$backup/data"
printf 'projet=%s\nservice=%s\n' "$projet" "$service" > "$backup/compose.txt"
printf 'Sauvegarde terminee avant mise a jour.\n' > "$backup/SAUVEGARDE-TERMINEE.txt"
backup_complete=1

printf 'Extraction dans %s...\n' "$installation"
installation_changed=1
# Remplacer app/ entierement retire aussi les routes supprimees du nouveau ZIP.
# L'ancienne version reste disponible dans la sauvegarde.
if [ -d "$installation/app" ]; then
    mv "$installation/app" "$backup/app"
fi
7z x "$package" -o"$installation"
printf 'Restauration de .env et data/ (permissions conservees)...\n'
cp -a "$backup/.env" "$installation/.env"
# Copier le contenu evite de creer accidentellement data/data.
cp -a "$backup/data/." "$installation/data/"

cd "$installation"
printf 'Reconstruction et recreation du service %s...\n' "$service"
compose --env-file "$installation/.env" -f "$installation/docker-compose.yml" -p "$projet" up -d --build --force-recreate "$service"

printf 'Verification du demarrage (jusqu a 120 secondes)...\n'
attempt=0
while [ "$attempt" -lt 60 ]; do
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")
    case "$health" in
        healthy) break ;;
        unhealthy|exited|dead) fail "Le service ne demarre pas correctement (etat : $health)." ;;
    esac
    attempt=$((attempt + 1))
    sleep 2
done
[ "$health" = healthy ] || fail "Le service n'est pas devenu healthy en 120 secondes."
compose --env-file "$installation/.env" -f "$installation/docker-compose.yml" -p "$projet" ps
printf '\nMise a jour terminee. Sauvegarde conservee : %s\n' "$backup"
