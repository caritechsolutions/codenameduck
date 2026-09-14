/*
 *  Copyright (c) 2020 The LG Electronics. All Rights Reserved.
*/

//key values defined for function onKeyDown(event)
var Key = {
    'Number1': hcap.key.Code.NUM_1,
    'Number2': hcap.key.Code.NUM_2,
    'Number3': hcap.key.Code.NUM_3,
    'Number4': hcap.key.Code.NUM_4,
    'Number5': hcap.key.Code.NUM_5,
    'Number6': hcap.key.Code.NUM_6,
    'Number7': hcap.key.Code.NUM_7,
    'Number8': hcap.key.Code.NUM_8,
    'Number9': hcap.key.Code.NUM_9,
    'Number0': hcap.key.Code.NUM_0,
    'Up': hcap.key.Code.UP,
    'Left': hcap.key.Code.LEFT,
    'OK': hcap.key.Code.ENTER,
    'Right': hcap.key.Code.RIGHT,
    'Down': hcap.key.Code.DOWN,
    'Power': hcap.key.Code.POWER,
    'ChannelUp': hcap.key.Code.CH_UP,
    'ChannelDown': hcap.key.Code.CH_DOWN,
    'Red': hcap.key.Code.RED,
    'Green': hcap.key.Code.GREEN,
    'Yellow': hcap.key.Code.YELLOW,
    'Blue': hcap.key.Code.BLUE,
    'Rewind': hcap.key.Code.REWIND,
    'Play': hcap.key.Code.PLAY,
    'Pause': hcap.key.Code.PAUSE,
    'Forward': hcap.key.Code.FAST_FORWARD,
    'Stop': hcap.key.Code.STOP,
    'Back': hcap.key.Code.BACK,
    'Menu': hcap.key.Code.MENU,
    'Home': hcap.key.Code.PORTAL,
    'Exit': hcap.key.Code.EXIT,
    'Guide': hcap.key.Code.GUIDE,
    'TV': hcap.key.Code.TV,
    'Info': hcap.key.Code.INFO,
    'Opt': hcap.key.Code.T_OPT,
    'Text': hcap.key.Code.TEXT,
    'Power': hcap.key.Code.POWER,
    'Portal': hcap.key.Code.PORTAL
}
var date = new Date();

function run() {
    window.setTimeout("initialize()", 2000);
}

function initialize() {
    try {
        document.addEventListener("keydown", onKeyDown , true);
        setDebugMode();
        log("initialize completed!");
    }
    catch (e) {
        log("Initialize Error: " + e.message);
    }
}

function log(msg) {
    var logArea = document.getElementById('log_area');
    logArea.innerHTML += ('[' + getTimeStamp() + '] ' + msg + '<br/>');
}

function clearLogMsg() {
    var logArea = document.getElementById('log_area');
    logArea.innerHTML = "Log Messages Clear<br>";
}

function setDebugMode() {
    hcap.system.setBrowserDebugMode({
        "debugMode": true,
        "onSuccess": function () {
            log("#Success to set browser debug mode");
        },
        "onFailure": function (f) {
            log("#Fail to set browser debug mode(errorMessage = " + f.errorMessage + ")");
        }
    });
}

function getTimeStamp() {
    var result = ("0" + (date.getMonth() + 1)).slice(-2) + '-' +
        ("0" + date.getDate()).slice(-2) + ' ' +
        ("0" + date.getHours()).slice(-2) + ':' +
        ("0" + date.getMinutes()).slice(-2) + ':' +
        ("0" + date.getSeconds()).slice(-2);
    return result;
}

function hideShow(element, status){
    document.getElementById(element).style.display = status;
} 