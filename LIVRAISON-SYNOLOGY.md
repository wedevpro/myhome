# Livrer un package

## 1. Copier le package

Copier le fichier myhome-synology.zip sur le NAS dans le répertoire \\NAS\docker

## 2. Déployer le package

Pour la première livraison renommée, si le dossier d'installation conserve son ancien nom, utilisez le script fourni avec `MYHOME_DIR` renseigné au chemin réel, comme indiqué dans [GUIDE-SYNOLOGY.md](GUIDE-SYNOLOGY.md#passage-au-nom-myhome). Ne créez pas un dossier `data/` vide à la place des données existantes.

1. Ouvrir une fenêtre bash
2. Se connecter en SSH
```sh
ssh 192.168.1.46
```
3. Se déplacer dans le répertoire /volume1/docker
```sh
cd /volume1/docker
```
4. Exécuter le fichier update-myhome.sh
```sh
sudo sh update-myhome.sh myhome-synology.zip
```

Note : à l'invite "Would you like to replace the existing file [...]", renseigner "A" (Always)

## 3. Résumé des commandes sur bash

```sh
ssh 192.168.1.46
cd /volume1/docker
sudo sh update-myhome.sh myhome-synology.zip
```
