/*
 *  Copyright (c) 2020 The LG Electronics. All Rights Reserved.
 *  Pro:Centric Smart TV/STB Sample Code - Media
 */


/* 
If the TV has Channel streaming, you must call the stopCurrentChannel() function before streaming media.
If there is no Channel streaming on the TV, the stopCurrentChannel function returns the fail function. However, this is normal operation, so just skip it.
*/

function stopCurrentChannel() {
    idcap.request( "idcap://tv/channel/stop" , {
        "onSuccess" : function() {
            log("onSuccess : stopCurrentChannel");
            hideShow("stopChannelSuccess", "inline");
        },
        "onFailure" : function(f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("stopChannelFail", "inline");
        }
    });
}

function startUp() {
    idcap.request( "idcap://tv/media/startup" , {
        "parameters": {
        },
        "onSuccess" : function(s) {
            log("[1] Startup");
            hideShow("startUpMediaSuccess", "inline");
        },
        "onFailure" : function(f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("startUpMediaFail", "inline");
        }
    });
}

function createMedia(src) {
    idcap.request( "idcap://tv/media/create" , {
        "parameters": {
            "url" : src,
            "mimeType" : "video/mp4"
        },
        onSuccess: function (s) {
            log("[2] Create Media success");
            hideShow("createMediaSuccess", "inline");
            log(src);
        },
        onFailure: function (f) {
            log("Error : " + f.errorMessage);
            hideShow("createMediaFail", "inline");
        },
    });
}

function play() {
    idcap.request( "idcap://tv/media/control" , {
        "parameters": {
            "command":"play",
            "repeatCount" : 0,
        },
        "onSuccess": function (s) {
            log("[3] Play");
            hideShow("playMediaSuccess", "inline");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("playMediaFail", "inline");
        }
    });
}

function stop() {
    idcap.request( "idcap://tv/media/control" , {
        "parameters": {
            "command":"stop",
        },
        "onSuccess": function (s) {
            log("[1] Stop");
            hideShow("stopMediaSuccess", "inline");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("stopMediaFail", "inline");
        }
    });
}

function destroy() {
    idcap.request( "idcap://tv/media/destroy" , {
        "onSuccess": function (s) {
            log("[2] Destroy");
            hideShow("destroyMediaSuccess", "inline");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("destroyMediaFail", "inline");
        }
    });
}

function shutDown() {
    idcap.request( "idcap://tv/media/shutdown" , {
        "onSuccess": function (s) {
            log("[3] Shutdown");
            hideShow("shutDownMediaSuccess", "inline");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("shutDownMediaFail", "inline");
        }
    });
}

function reboot() {
	idcap.request( "idcap://power/command" , {
        "parameters": {
            "powerCommand" : "reboot"
        },
        "onSuccess": function () {
            consoleMsg("Success to reboot");
        },
        "onFailure": function (err) {
            consoleMsg("Fail to reboot : " + err.errorMessage);
        }
    });
}

//Set Streaming video size
function setVideoSize(x, y, w, h) {
    idcap.request("idcap://video/size/set" , {
        "parameters": {
            "x" : x,
            "y" : y,
            "width" : w,
            "height" : h,
        },
        "onSuccess": function (s) {
            log("onSuccess : setVideoSize - (" + x + "," + y + ") (" + w + "/" + h + ")");
            hideShow("changeVideoSizeSuccess", "inline");
        },
        "onFailure": function (err) {
            log("onFailure : errorMessage = " + err.errorMessage);
            hideShow("changeVideoSizeFail", "inline");
        }
    });
}

//Call media play sequence automatically
function mediaStartAuto(src) {
    idcap.request( "idcap://tv/media/startup" , {
        "parameters": {},
        "onSuccess": function (s) {
            log("[1] Startup");
            hideShow("startUpMediaSuccess", "inline");

            //create Media
            idcap.request( "idcap://tv/media/create" , {
                "parameters": {
                    "url" : src,
                    "mimeType" : "video/mp4"
                },
                "onSuccess": function (s) {
                    log("[2] createMedia");
                    hideShow("createMediaSuccess", "inline");

                    //play Media
                    idcap.request( "idcap://tv/media/control" , {
                        "parameters": {
                            "command":"play",
                            "repeatCount" : 2,
                        },
                        "onSuccess": function (s) {
                            log("[3] Play");
                            hideShow("playMediaSuccess", "inline");
                            hideShow("autoPlaySuccess", "inline");
                        },
                        "onFailure": function (f) {
                            log("onFailure : errorMessage = " + f.errorMessage);
                            hideShow("playMediaFail", "inline");
                            hideShow("autoPlayFail", "inline");
                        }
                    });
                },
                "onFailure": function (f) {
                    hideShow("createMediaFail", "inline");
                    hideShow("autoPlayFail", "inline");
                }
            });
        },
        "onFailure": function () {
            hideShow("startUpMediaFail", "inline");
            hideShow("autoPlayFail", "inline");
        }
    });
}


//Call media shutdown sequence automatically 
function mediaStopAuto() {
    idcap.request( "idcap://tv/media/control" , {
        "parameters": {
            "command":"stop",
        },
        "onSuccess": function (s) {
            log("[1] Stop");
            hideShow("stopMediaSuccess", "inline");

            //Destroy the media object
            idcap.request( "idcap://tv/media/destroy" , {
                "onSuccess": function (s) {
                    log("[2] Destroy");
                    hideShow("destroyMediaSuccess", "inline");

                    //ShutDonw - Return video layer(remove media pipeline)
                    idcap.request( "idcap://tv/media/shutdown" , {
                        "onSuccess": function (s) {
                            log("[3] Shutdown");
                            hideShow("shutDownMediaSuccess", "inline");
                            hideShow("autoShutdownSuccess", "inline");
                        },
                        "onFailure": function (f) {
                            log("onFailure : errorMessage = " + f.errorMessage);                                
                            hideShow("shutDownMediaFail", "inline");
                            hideShow("autoShutdownFail", "inline");
                        }
                    });
                },
                "onFailure": function (f) {
                    log("onFailure : errorMessage = " + f.errorMessage);
                    hideShow("destroyMediaFail", "inline");
                    hideShow("autoShutdownFail", "inline");
                }
            });
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("stopMediaFail", "inline");
            hideShow("autoShutdownFail", "inline");
        }
    });
}

document.addEventListener(
    "idcap::media_event_received",
    function (param) {
        console.log("event type = " + param.eventType);
        if(param.eventType == "play_start")
        {
            setVideoSize(500, 400, 379, 230);//set video size and location on 'videoChannelLG' 
        }
        else
        {
            log("media_event_received:[" + param.result + "] Error = " + param.errorMessage);
        }	
    },
    false
);

//key values defined for function onKeyDown(event)
idcap.key = {};
idcap.key.Code = {
    NUM_0: 0x0030,  /* Number 0 key.     */
    NUM_1: 0x0031,  /* Number 1 key.     */
    NUM_2: 0x0032,  /* Number 2 key.     */
    NUM_3: 0x0033,  /* Number 3 key.     */
    NUM_4: 0x0034,  /* Number 4 key.     */
    NUM_5: 0x0035,  /* Number 5 key.     */
    NUM_6: 0x0036,  /* Number 6 key.     */
    NUM_7: 0x0037,  /* Number 7 key.     */
    NUM_8: 0x0038,  /* Number 8 key.     */
    NUM_9: 0x0039,  /* Number 9 key.     */
    CH_UP: 0x01AB,  /* Channel up key.     */
    CH_DOWN: 0x01AC,    /* Channel down key.     */
    GUIDE: 0x01CA,  /* Guide key.     */
    INFO: 0x01C9,   /* Info key.     */
    LEFT: 0x0025,   /* Left arrow key.     */
    UP: 0x0026,     /* Up arrow key.     */
    RIGHT: 0x0027,  /* Right arrow key.     */
    DOWN: 0x0028,   /* Down arrow key.     */
    ENTER: 0x000D,  /* Enter key.     */
    BACK: 0x01CD,   /* Backspace key.     */
    EXIT: 0x03E9,   /* Exit key.     */
    RED: 0x0193,    /* Red color key.     */
    GREEN: 0x0194,  /* Green color key.     */
    YELLOW: 0x0195, /* Yellow color key.     */
    BLUE: 0x0196,   /* Blue color key.     */
    STOP: 0x019D,   /* Stop key.     */
    PLAY: 0x019F,   /* Play key.     */
    PAUSE: 0x0013,  /* Pause key.     */
    REWIND: 0x019C, /* Rewind key.     */
    FAST_FORWARD: 0x01A1,   /* Fast forward key.     */
    PORTAL: 0x025A, /* Portal key.     */
    POWER: 0x0199,  /* Power key.     */
    VOL_UP: 0x01BF, /* Volume up key.     */
    VOL_DOWN: 0x01C0,   /* Volume down key.     */
    MUTE: 0x01C1,       /* Mute key.     */
    FORWARD: 0x00A7,    /* Forward key.     */
    ZOOM: 0x00FB,       /* Zoom key.     */
    SETTINGS: 0x0263,   /* Settings key.     */
    MENU: 0x0012,   /* Menu key or home key.     */
    T_OPT: 0x03EC,      /* Text option key.     */
    TEXT: 0x01CB,       /* Teletext key.     */
    TV: 0x02DA,         /* TV key.     */
    SMART_HOME: 0x02DE, /* Smart Home key.     */
};

//Do each demo item on the app.
function onKeyDown(event) {
    log('event.keyCode : ' + event.keyCode);
    switch (event.keyCode) {
        case idcap.key.Code.NUM_0:
            clearLogMsg();
            break;
        case idcap.key.Code.NUM_1:
            startUp();
            break;
        case idcap.key.Code.NUM_2:
            createMedia("http://192.168.0.5:8080/procentric/application/sample/AOA_Dance_Practice.mp4");
            break;
        case idcap.key.Code.NUM_3:
            createMedia("http://192.168.0.5:8080/procentric/application/sample/video-auto-rotate.mp4");
            break;
        case idcap.key.Code.NUM_4:
            play();
            break;
        case idcap.key.Code.NUM_5:
            stop();
            break;
        case idcap.key.Code.NUM_6:
            destroy();
            break;
        case idcap.key.Code.NUM_7:
            shutDown();
            break;
        case idcap.key.Code.NUM_8:
            reboot();
            break;
        case idcap.key.Code.GUIDE:
            mediaStartAuto("http://192.168.0.5:8080/procentric/application/sample/AOA_Dance_Practice.mp4");
            break;
        case idcap.key.Code.INFO:
            mediaStopAuto();
            break;
        case idcap.key.Code.PORTAL:
            window.location.href = "";
            break;
        default:
            break;
    }
}

