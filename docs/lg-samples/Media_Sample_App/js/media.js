/*
 *  Copyright (c) 2020 The LG Electronics. All Rights Reserved.
 *  Pro:Centric Smart TV/STB Sample Code - Media
 */

var _stateMedia = null;
var _media = null;
var _media_status = 0;

/* 
If the TV has Channel streaming, you must call the stopCurrentChannel() function before streaming media.
If there is no Channel streaming on the TV, the stopCurrentChannel function returns the fail function. However, this is normal operation, so just skip it.
*/

function stopCurrentChannel() {
    hcap.channel.stopCurrentChannel({
        "onSuccess": function () {
            log("onSuccess : stopCurrentChannel");
            hideShow("stopChannelSuccess", "inline");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("stopChannelFail", "inline");
        }
    });
}

function startUp() {
    hcap.Media.startUp({
        "onSuccess": function () {
            log("[1] Startup");
            hideShow("startUpMediaSuccess", "inline");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("startUpMediaFail", "inline");
        }
    });
}
function createMedia(src) {
    _media = hcap.Media.createMedia({
        "url": src,
        "mimeType": "video/mp4",
        onSuccess: function () {
            log("[2] Create Media success");
            hideShow("createMediaSuccess", "inline");
            log(src);
        },
        onFailure: function (e) {
            log("Error : " + e.errorMessage);
            hideShow("createMediaFail", "inline");
        },
    });
}
function play() {
    _media.play({
        "repeatCount": 0,
        "onSuccess": function () {
            log("[3] Play");
            hideShow("playMediaSuccess", "inline");
            _media_status = 1;                          //media is playing
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("playMediaFail", "inline");
        }
    });
}
function stop() {
    if (_media != null) {
        _media.stop({
            "onSuccess": function () {
                log("[1] Stop");
                hideShow("stopMediaSuccess", "inline");
            },
            "onFailure": function (f) {
                log("onFailure : errorMessage = " + f.errorMessage);
                hideShow("stopMediaFail", "inline");
            }
        });
    }
    else {
        log("Media is null");
    }
}
function destroy() {
    _media.destroy({
        "onSuccess": function () {
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
    hcap.Media.shutDown({
        "onSuccess": function () {
            log("[3] Shutdown");
            hideShow("shutDownMediaSuccess", "inline");
            _media_status = 0;                      //stop
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("shutDownMediaFail", "inline");
        }
    });
}

function reboot() {
	hcap.power.reboot({
		"onSuccess": function () {
			consoleMsg("Success to reboot");
		},
		"onFailure": function (f) {
			consoleMsg("Fail to reboot : " + f.errorMessage);
		}
	});
}
//Set Streaming video size
function setVideoSize(x, y, w, h) {
    hcap.video.setVideoSize({
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "onSuccess": function () {
            log("onSuccess : setVideoSize - (" + x + "," + y + ") (" + w + "/" + h + ")");
            hideShow("changeVideoSizeSuccess", "inline");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("changeVideoSizeFail", "inline");
        }
    });
}

//Call media play sequence automatically
function mediaStartAuto(src) {
    hcap.Media.startUp({
        "onSuccess": function () {
            log("[1] Startup");
            hideShow("startUpMediaSuccess", "inline");

            //create Media
            _media = hcap.Media.createMedia({
                "url": src,
                "mimeType": "video/mp4",
                "onSuccess": function () {
                    log("[2] createMedia");
                    hideShow("createMediaSuccess", "inline");

                    //play Media
                    _media.play({
                        "repeatCount": 1,
                        "onSuccess": function () {
                            log("[3] Play");
                            hideShow("playMediaSuccess", "inline");
                            hideShow("autoPlaySuccess", "inline");
                            _media_status = 1;                          //Media is playing
                        },
                        "onFailure": function (f) {
                            log("onFailure : errorMessage = " + f.errorMessage);
                            hideShow("playMediaFail", "inline");
                            hideShow("autoPlayFail", "inline");
                        }
                    });
                },
                "onFailure": function () {
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
    if (_media != null) {
        _media.stop({
            "onSuccess": function () {
                log("[1] Stop");
                hideShow("stopMediaSuccess", "inline");

                //Destroy the media object
                _media.destroy({
                    "onSuccess": function () {
                        log("[2] Destroy");
                        hideShow("destroyMediaSuccess", "inline");

                        //ShutDonw - Return video layer(remove media pipeline)
                        hcap.Media.shutDown({
                            "onSuccess": function () {
                                log("[3] Shutdown");
                                hideShow("shutDownMediaSuccess", "inline");
                                hideShow("autoShutdownSuccess", "inline");
                                _media_status = 0;                              //Media stopped
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
    else {
        log("Media is null");
        hideShow("autoShutdownFail", "inline");
    }
}

//Set Streaming video size
function setVideoSize(x, y, w, h) {
    hcap.video.setVideoSize({
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "onSuccess": function () {
            log("onSuccess : setVideoSize - (" + x + "," + y + ") (" + w + "/" + h + ")");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
    });
}

document.addEventListener(
    "media_event_received",
    function (param) {
        console.log("media_event_received = " + param.eventType);
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

//Do each demo item on the app.
function onKeyDown(event) {
    log('event.keyCode : ' + event.keyCode);
    switch (event.keyCode) {
        case Key.Number0:
            clearLogMsg();
            break;
        case Key.Number1:
            startUp();
            break;
        case Key.Number2:
            createMedia("http://IP:Port/samplpe.mp4");
            break;
        case Key.Number3:
            createMedia("http://IP:Port/samplpe.mpeg");
            break;
        case Key.Number4:
            play();
            break;
        case Key.Number5:
            stop();
            break;
        case Key.Number6:
            destroy();
            break;
        case Key.Number7:
            shutDown();
            break;
        case Key.Number8:
            reboot();
            break;
        case Key.Guide:
            mediaStartAuto("http://IP:Port/samplpe.mp4");
            break;
        case Key.Info:
            mediaStopAuto();
            break;
        case Key.Portal:
            window.location.href = "";
            break;
        default:
            break;
    }
}

