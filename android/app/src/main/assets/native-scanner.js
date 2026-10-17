(function installNativeScanner(origin) {
    "use strict";
    if (window.top !== window || window.location.protocol !== "https:" || window.location.origin !== origin) return;
    if (window.myHomeNativeScanner) return;
    const prompt = window.prompt.bind(window);
    Object.defineProperty(window, "myHomeNativeScanner", {
        value: Object.freeze({
            version: 1,
            scan(camera) {
                if (camera !== "environment" && camera !== "user")
                    return JSON.stringify({ status: "error", message: "Caméra inconnue." });
                return prompt("myhome:native-scan:v1", camera)
                    || JSON.stringify({ status: "cancelled" });
            }
        }),
        writable: false,
        configurable: false
    });
})
