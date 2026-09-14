
window.onload = function () {
    hcap.system.setBrowserDebugMode({
        "debugMode": true,
        "onSuccess": function () {
            console.log("onSuccess");
        },
        "onFailure": function (f) {
            console.log("onFailure : errorMessage = " + f.errorMessage);
        }
    });

    var RCU = {
        Button: {
            BTN_LEFT: 37,
            BTN_UP: 38,
            BTN_RIGHT: 39,
            BTN_DOWN: 40,
            BTN_CLEAR: 12,
            BTN_OK: 13,
            BTN_0: 48,
            BTN_1: 49,
            BTN_2: 50,
            BTN_3: 51,
            BTN_4: 52,
            BTN_5: 53,
            BTN_6: 54,
            BTN_7: 55,
            BTN_8: 56,
            BTN_9: 57,
            BTN_YELLOW: 405,
            BTN_BLUE: 406,
            BTN_GREEN: 404,
            BTN_RED: 403,
            
        }
    }
    document.body.addEventListener('keydown', function (e) {
        console.log("e.keyCode====" + e.keyCode);
        switch (e.keyCode) {
            // Video Layer
            case RCU.Button.BTN_1:
                location.href = './Apps/player_sample/player_sample.html';
                break;

            //
            case RCU.Button.BTN_2:
                location.href = './Apps/videotag_sample/simpleVideo.html';
                break;

            case RCU.Button.BTN_GREEN:
                reload();
                break;

            
            case RCU.Button.BTN_RED:
                reboot();
                break;
        }
    })
}