//IP Streaming
function playIPChannel(ip, port) {
    var param = {
        "channelType": hcap.channel.ChannelType.IP,
        "ip": ip,
        "port": parseInt(port),
        "ipBroadcastType": hcap.channel.IpBroadcastType.UDP,
        "onSuccess": function () {
            log("onSuccess");
           
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
    };
    hcap.channel.requestChangeCurrentChannel(param);
}

//RF Streaming 
function playDvbtChannel(channelType, frequency, programNumber, rfBroadcastType) {
    var param = {
        "channelType": channelType,
        "frequency": parseInt(frequency),
        "programNumber": programNumber,
        "rfBroadcastType": rfBroadcastType,
        "onSuccess": function () {
            log("onSuccess : playDvbtChannel");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
    };
    hcap.channel.requestChangeCurrentChannel(param);
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
    "channel_changed",
    function (param) {
        if(param.result == true)
        {
            setVideoSize(500, 350, 379, 218);//set video size for the div 'videoChannelLG' 

        }
        else
        {
            log("channel_changed:[" + param.result + "] Error = " + param.errorMessage);
        }		
    },
    false
);


//get RF channel info 
function getCurrentChannel() {
    hcap.channel.getCurrentChannel({
        "onSuccess": function (s) {
            var str = "Succss to get current channel information <br>" +
                "channel status    : " + s.channelStatus + "<br>" +
                "channel type      : " + s.channelType + "<br>" +
                "logical number    : " + s.logicalNumber + "<br>" +
                "frequency         : " + s.frequency + "<br>" +
                "program number    : " + s.programNumber + "<br>" +
                "major number      : " + s.majorNumber + "<br>" +
                "minor number      : " + s.minorNumber + "<br>" +
                "satellite ID      : " + s.satelliteId + "<br>" +
                "polarization      : " + s.polarization + "<br>" +
                "rf broadcast type : " + s.rfBroadcastType + "<br>" +
                "ip                : " + s.ip + "<br>" +
                "port              : " + s.port + "<br>" +
                "ip broadcast type : " + s.ipBroadcastType + "<br>" +
                "symbol rate       : " + s.symbolRate + "<br>" +
                "pcr pid           : " + s.pcrPid + "<br>" +
                "video pid         : " + s.videoPid + "<br>" +
                "video stream type : " + s.videoStreamType + "<br>" +
                "audio pid         : " + s.audioPid + "<br>" +
                "audio stream type : " + s.audioStreamType + "<br>" +
                "signal strength   : " + s.signalStrength + "<br>" +
                "source address    : " + s.sourceAddress + "<br>";
            log(str);
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
    });
}

//Stop Streaming
function stopChannel() {
    hcap.channel.stopCurrentChannel({
        "onSuccess": function () {
            log("onSuccess : stopCurrentChannel");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
    });
}

//Replay the current stopped channel.
function replayCurrentChannel() {
    hcap.channel.replayCurrentChannel({
        "onSuccess": function () {
            log("onSuccess : stopCurrentChannel");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
    });
}

//Get the list of supported audio languages in the current channel.
function getCurrentChannelAudioLanguageList() {
    hcap.channel.getCurrentChannelAudioLanguageList({
        "onSuccess" : function(s) {
            log("onSuccess : list = " + s.list);
        }, 
        "onFailure" : function(f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
    });
}

//Get supported subtitle list of the current channel.
function getCurrentChannelSubtitleList() {
    hcap.channel.getCurrentChannelSubtitleList({
        "onSuccess" : function(s) {
            log("onSuccess : list = " + s.list);
        }, 
        "onFailure" : function(f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
    });
}

//CH_UP, CH_DOWN key processed by TV or delivered to HCAP app.
var channel_up_down = 0;
hcap.key.addKeyItem({
    "keycode" : 0,
    "virtualKeycode" : hcap.key.Code.CH_UP,
    "attribute" : 1,
    "onSuccess" : function() {
        log("onSuccess");
    }, 
    "onFailure" : function(f) {
        log("onFailure : errorMessage = " + f.errorMessage);
    }
    });

hcap.key.addKeyItem({
        "keycode" : 0,
        "virtualKeycode" : hcap.key.Code.CH_DOWN,
        "attribute" : 1,
        "onSuccess" : function() {
            log("onSuccess");
        }, 
        "onFailure" : function(f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
});

//Turn on/off changing channels tuned by the TV(LG Firmware) by CH_UP, CH_DOWN keys.
function channel_up_down_KEY() {
    if(channel_up_down === 0)
    {
        channel_up_down = 1;
        hcap.key.addKeyItem({
        "keycode" : 0,
        "virtualKeycode" : hcap.key.Code.CH_UP,
        "attribute" : 0,
        "onSuccess" : function() {
            log("onSuccess");
        }, 
        "onFailure" : function(f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
        });

        hcap.key.addKeyItem({
                "keycode" : 0,
                "virtualKeycode" : hcap.key.Code.CH_DOWN,
                "attribute" : 0,
                "onSuccess" : function() {
                   log("onSuccess");
                }, 
                "onFailure" : function(f) {
                    log("onFailure : errorMessage = " + f.errorMessage);
                }
        });
    }
    else
    {
        channel_up_down = 0;
        hcap.key.addKeyItem({
            "keycode" : 0,
            "virtualKeycode" : hcap.key.Code.CH_UP,
            "attribute" : 1,
            "onSuccess" : function() {
                log("onSuccess");
            }, 
            "onFailure" : function(f) {
                log("onFailure : errorMessage = " + f.errorMessage);
            }
            });
    
            hcap.key.addKeyItem({
                    "keycode" : 0,
                    "virtualKeycode" : hcap.key.Code.CH_DOWN,
                    "attribute" : 1,
                    "onSuccess" : function() {
                        log("onSuccess");
                    }, 
                    "onFailure" : function(f) {
                        log("onFailure : errorMessage = " + f.errorMessage);
                    }
            });
    }
    
}

//Do each demo item on the app.
function onKeyDown(event) {
    log('event.keyCode : ' + event.keyCode);
    switch (event.keyCode) {
        case Key.Number0:
            clearLogMsg();
            break;
        case Key.Number1:
            playIPChannel("239.1.1.1", 8208);
            break;
        case Key.Number2:
            playIPChannel("239.1.1.2", 8208);
            break;
        case Key.Number3:
            playDvbtChannel(1, 578000000, 770, 17);
            break;
        case Key.Number4:
            getCurrentChannel();
            break;
        case Key.Number5:
            stopChannel();
            break;
        case Key.Number6:
            replayCurrentChannel();
            break;
        case Key.Number7:
            getCurrentChannelAudioLanguageList();
            break;
        case Key.Number8:
            getCurrentChannelSubtitleList();
            break;
        case Key.Number9:
            channel_up_down_KEY();
            break;
        case Key.Portal:
            window.location.href = "";
            break;
        default:
            break;
    }
}
