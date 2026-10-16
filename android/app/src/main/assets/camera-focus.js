(function installCameraFocus(origin) {
    "use strict";
    // No native interface: this only configures camera streams already permitted
    // by WebView, on the NAS's top-level HTTPS document.
    if (window.top !== window || window.location.protocol !== "https:" || window.location.origin !== origin) return;
    const devices = navigator.mediaDevices;
    const marker = Symbol.for("fr.myhome.android.cameraFocus");
    if (!devices || typeof devices.getUserMedia !== "function" || devices.getUserMedia[marker]) return;
    const original = devices.getUserMedia;
    const streams = new WeakMap();

    function isRearCamera(track, constraints) {
        const actual = track.getSettings().facingMode;
        if (actual) return actual === "environment";
        let requested = constraints && constraints.video && constraints.video.facingMode;
        if (requested && typeof requested === "object" && !Array.isArray(requested))
            requested = requested.exact || requested.ideal;
        return requested === "environment"
            || (Array.isArray(requested) && requested.length > 0 && requested.every(mode => mode === "environment"));
    }

    async function requestFocus(track) {
        try {
            if (track.readyState !== "live" || typeof track.getCapabilities !== "function"
                    || typeof track.applyConstraints !== "function") return;
            const modes = track.getCapabilities().focusMode;
            if (!Array.isArray(modes) || !modes.includes("continuous")) return;
            // applyConstraints replaces earlier constraints. Preserve resolution,
            // device selection, and any other existing settings.
            const constraints = track.getConstraints();
            const advanced = [...(constraints.advanced || [])];
            if (!advanced.some(entry => entry.focusMode === "continuous" && Object.keys(entry).length === 1))
                advanced.push({ focusMode: "continuous" });
            await track.applyConstraints({
                ...constraints,
                advanced
            });
        } catch (_) {
            // Optional autofocus support must never prevent scanning or playback.
        }
    }

    function getUserMedia() {
        const constraints = arguments[0];
        return Reflect.apply(original, this, arguments).then(stream => {
            try {
                const tracks = stream.getVideoTracks().filter(track => isRearCamera(track, constraints));
                streams.set(stream, tracks);
                // Do not wait for the driver: an ignored/hanging focus request
                // must not delay returning the stream and starting the preview.
                tracks.forEach(track => { void requestFocus(track); });
            } catch (_) { /* Preserve the original stream even on old WebViews. */ }
            return stream;
        });
    }

    Object.defineProperty(getUserMedia, marker, { value: true });
    try {
        devices.getUserMedia = getUserMedia;
        if (devices.getUserMedia !== getUserMedia) return;
    } catch (_) { return; }

    // A real tap produces a click; scrolling over the preview does not. Only
    // streams acquired through this document's wrapper can be reconfigured.
    document.addEventListener("click", event => {
        if (!(event.target instanceof HTMLVideoElement)) return;
        const tracks = streams.get(event.target.srcObject);
        if (tracks) tracks.forEach(track => { void requestFocus(track); });
    }, true);
})
