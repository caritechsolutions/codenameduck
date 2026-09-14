//IP Streaming
function playIPChannel(ip, port) {
    idcap.request( "idcap://tv/channel/change/request" , {
        "parameters": {
            "channelType" : "ip",
            "ip" : ip,
            "port" : parseInt(port),
            "ipBroadcastType" : "udp"
        },
        "onSuccess": function () {
            log("onSuccess");
        },
        "onFailure": function (err) {
            log("onFailure : errorMessage = " + err.errorMessage);
        }
    });
}


//RF Streaming 
function playDvbtChannel(channelType, frequency, programNumber, rfBroadcastType) {
    idcap.request( "idcap://tv/channel/change/request" , {
        "parameters": {
            "channelType" : "rf",
            "frequency" : parseInt(frequency),
            "programNumber" : programNumber,
            "rfBroadcastType" : "terrestrial"
        },
        "onSuccess": function () {
            log("onSuccess");
        },
        "onFailure": function (err) {
            log("onFailure : errorMessage = " + err.errorMessage);
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
        "onSuccess": function () {
            log("onSuccess : setVideoSize - (" + x + "," + y + ") (" + w + "/" + h + ")");
        },
        "onFailure": function (err) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
    });
}

document.addEventListener(
    "idcap::channel_changed",
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
    idcap.request( "idcap://tv/channel/get" , {
        "parameters": {
        },
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
    idcap.request( "idcap://tv/channel/stop" , {
        "onSuccess": function () {
            log("onSuccess : stopChannel");
        },
        "onFailure": function (f) {
            log("onFailure : errorMessage = " + f.errorMessage);
        }
    });
}

//Replay the current stopped channel.
function replayCurrentChannel() {
    idcap.request( "idcap://tv/channel/replay" , {
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
    idcap.request( "idcap://tv/channel/audiolanguageindex/get" , {
        "parameters": {    },
        "onSuccess" : function(s) {
            log("onSuccess : index = " + s.index);
        },
        "onFailure": function (err) {
            log("onFailure : errorMessage = " + err.errorMessage);
        }
    });
}

//Get supported subtitle list of the current channel.
function getCurrentChannelSubtitleList() {
    idcap.request( "idcap://tv/channel/subtitleindex/get" , {
        "parameters": {
        },
        "onSuccess" : function(s) {
            console.log("onSuccess : index = " + s.index);
        },
        "onFailure": function (err) {
            console.log("onFailure : errorMessage = " + err.errorMessage);
        }
    });
}

//CH_UP, CH_DOWN key processed by TV or delivered to IDCAP app.
var channel_up_down = 0;

idcap.request( "idcap://system/key/add" , {
    "parameters": {
        "keycode" : 0,
        "virtualKeycode" : "CH_UP",
        "attribute" : 1,
    },
    "onSuccess": function () {
        log("onSuccess");
    },
    "onFailure": function (err) {
        log("onFailure : errorMessage = " + err.errorMessage);
    }
});

idcap.request( "idcap://system/key/add" , {
    "parameters": {
        "keycode" : 0,
        "virtualKeycode" : "CH_DOWN",
        "attribute" : 1,
    },
    "onSuccess": function () {
        log("onSuccess");
    },
    "onFailure": function (err) {
        log("onFailure : errorMessage = " + err.errorMessage);
    }
});

//Turn on/off changing channels tuned by the TV(LG Firmware) by CH_UP, CH_DOWN keys.
function channel_up_down_KEY() {
    if(channel_up_down === 0)
    {
        channel_up_down = 1;

        idcap.request( "idcap://system/key/add" , {
            "parameters": {
                "keycode" : 0,
                "virtualKeycode" : "CH_UP",
                "attribute" : 0,
            },
            "onSuccess": function () {
                log("onSuccess");
            },
            "onFailure": function (err) {
                log("onFailure : errorMessage = " + err.errorMessage);
            }
        });

        idcap.request( "idcap://system/key/add" , {
            "parameters": {
                "keycode" : 0,
                "virtualKeycode" : "CH_DOWN",
                "attribute" : 0,
            },
            "onSuccess": function () {
                log("onSuccess");
            },
            "onFailure": function (err) {
                log("onFailure : errorMessage = " + err.errorMessage);
            }
        });
    }
    else
    {
        channel_up_down = 0;

        idcap.request( "idcap://system/key/add" , {
            "parameters": {
                "keycode" : 0,
                "virtualKeycode" : "CH_UP",
                "attribute" : 1,
            },
            "onSuccess": function () {
                log("onSuccess");
            },
            "onFailure": function (err) {
                log("onFailure : errorMessage = " + err.errorMessage);
            }
        });

        idcap.request( "idcap://system/key/add" , {
            "parameters": {
                "keycode" : 0,
                "virtualKeycode" : "CH_DOWN",
                "attribute" : 1,
            },
            "onSuccess": function () {
                log("onSuccess");
            },
            "onFailure": function (err) {
                log("onFailure : errorMessage = " + err.errorMessage);
            }
        });
    }
    
}


//Do each demo item on the app.
function onKeyDown(event) {
    log('event.keyCode : ' + event.keyCode);

    switch (event.keyCode) {
        case idcap.key.Code.NUM_0:
            clearLogMsg();
            break;
        case idcap.key.Code.NUM_1:
            playIPChannel("239.1.1.1", 8208);
            break;
        case idcap.key.Code.NUM_2:
            playIPChannel("239.1.1.2", 8208);
            break;
        case idcap.key.Code.NUM_3:
            playDvbtChannel(1, 578000000, 770, 17);
            break;
        case idcap.key.Code.NUM_4:
            getCurrentChannel();
            break;
        case idcap.key.Code.NUM_5:
            stopChannel();
            break;
        case idcap.key.Code.NUM_6:
            replayCurrentChannel();
            break;
        case idcap.key.Code.NUM_7:
            getCurrentChannelAudioLanguageList();
            break;
        case idcap.key.Code.NUM_8:
            getCurrentChannelSubtitleList();
            break;
        case idcap.key.Code.NUM_9:
            channel_up_down_KEY();
            break;
        case idcap.key.Code.PORTAL:
            document.location.reload(true);
            break;
        default:
            break;
    }
}

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
    LAST_CH: 0x02C7,        /* Last channel key.     */
    PORTAL: 0x025A, /* Portal key.     */
    ORDER: 0x026F,  /* Order key.     */
    MINUS: 0x02C0,  /* Minus key or dash key.     */
    POWER: 0x0199,  /* Power key.     */
    VOL_UP: 0x01BF, /* Volume up key.     */
    VOL_DOWN: 0x01C0,   /* Volume down key.     */
    MUTE: 0x01C1,       /* Mute key.     */
    RECORD: 0x01A0,     /* Record key.     */
    PAGE_UP: 0x0021,    /* Page up key.     */
    PAGE_DOWN: 0x0022,  /* Page down key.     */
    RF_BYPASS: 0x001D,  /* RF bypass key.     */
    NEXT_DAY: 0x01A9,   /* Next day key.     */
    PREV_DAY: 0x01A8,   /* Previous day key.     */
    APPS: 0x005D,       /* Applications key.     */
    LINK: 0x025E,       /* Link key.     */
    FORWARD: 0x00A7,    /* Forward key.     */
    ZOOM: 0x00FB,       /* Zoom key.     */
    SETTINGS: 0x0263,   /* Settings key.     */
    NEXT_FAV_CH: 0x00B0,    /* Next favorite channel key.     */
    RES_1: 0x0070,  /* F1 (Reserved 1) key.     */
    RES_2: 0x0071,  /* F2 (Reserved 2) key.     */
    RES_3: 0x0072,  /* F3 (Reserved 3) key.     */
    RES_4: 0x0073,  /* F4 (Reserved 4) key.     */
    RES_5: 0x0074,  /* F5 (Reserved 5) key.     */
    RES_6: 0x0075,  /* F6 (Reserved 6) key.     */
    LOCK: 0x026B,   /* Lock key.     */
    SKIP: 0x026C,   /* Skip key.     */
    LIST: 0x03EE,   /* List key.     */
    LIVE: 0x026E,   /* Live key.     */
    ON_DEMAND: 0x026F,  /* On demand key.     */
    PINP_MOVE: 0x0270,  /* PINP move key.     */
    PINP_UP: 0x0271,    /* PINP up key.     */
    PINP_DOWN: 0x0272,  /* PINP down key.     */
    MENU: 0x0012,   /* Menu key or home key.     */
    AD: 0x02BC,     /* Audio description key.     */
    ALARM: 0x02BD,  /* Alarm key.     */
    AV_MODE: 0x001F,    /* AV mode key.     */
    SUBTITLE: 0x01CC,   /* Subtitle key or CC key.     */
    DISC_POWER_OFF: 0x02C1, /* Discrete power off key.     */
    DISC_POWER_ON: 0x02C2,  /* Discrete power on key.     */
    DVD: 0x02C3,        /* DVD key.     */
    EJECT: 0x019E,      /* Eject key.     */
    ENERGY_SAVING: 0x02C5,  /* Energy saving key.     */
    FAV: 0x02C6,        /* Favorite key.     */
    FLASHBK: 0x02C7,    /* Flashback key or last key.     */
    INPUT: 0x02C8,      /* Input key.     */
    MARK: 0x02C9,       /* Mark key.     */
    NETCAST: 0x03E8,    /* Netcast key.     */
    PIP: 0x02CB,        /* PIP key.     */
    PIP_CH_DOWN: 0x02CC,    /* PIP channel down key.     */
    PIP_CH_UP: 0x02CD,  /* PIP channel up key.     */
    PIP_INPUT: 0x02CE,  /* PIP input key.     */
    PIP_SWAP: 0x02CF,   /* PIP swap key.     */
    Q_MENU: 0x03EA,     /* Qmenu key.     */
    Q_VIEW: 0x03EF,     /* Qview key.     */
    RATIO: 0x003ED,     /* Aspect ratio key.     */
    SAP: 0x02D3,        /* SAP key.     */
    SIMPLINK: 0x02D4,   /* Simplink key.     */
    STB: 0x02D5,        /* STB key.     */
    T_OPT: 0x03EC,      /* Text option key.     */
    TEXT: 0x01CB,       /* Teletext key.     */
    SLEEP_TIMER: 0x02D9,    /* Sleep timer key.     */
    TV: 0x02DA,         /* TV key.     */
    TV_RAD: 0x02DB,     /* TV radio key.     */
    VCR: 0x02DC,        /* VCR key.     */
    POWER_LOWBATTERY: 0x02DD,    /* Power low battery key.     */
    SMART_HOME: 0x02DE, /* Smart Home key.     */
    SCREEN_REMOTE: 0x02DF,  /* Screen Remote key.     */
    POINTER: 0x02E0,    /* Pointer key.     */
    LG_3D: 0x02E1,      /* LG_3D key.     */
    DATA: 0x02E2        /* DATA key.     */
};