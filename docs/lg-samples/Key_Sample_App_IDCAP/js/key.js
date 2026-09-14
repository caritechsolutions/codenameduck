
/*
 *  Copyright (c) 2020 The LG Electronics. All Rights Reserved.
 *  Pro:Centric Smart TV/STB Sample Code - Key Mapping
 */
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

function setVolumeLevel(level) {
    idcap.request( "idcap://audio/volumelevel/set" , {
        "parameters" : {
            "level" : level ,
        },
        "onSuccess": function () {
            log("onSuccess to set volume level : 50");
            log(" The Num1 key events are delivered to the HCAP app.");
            hideShow("setVolumeSuccess", "inline");
        },
        "onFailure": function (err) {
            log("onFailure : errorMessage = " + f.errorMessage);
            hideShow("setVolumeFail","inline");
        }
    });
}

function getNetworkInfo() {
    idcap.request( "idcap://network/configuration/get" , {
        "parameters": {},
        "onSuccess": function (cbObject) {
            log("-------------------------------");
            log("[ Success to get network info ]");
            log("#wired.state = " + cbObject.wired.state);
            log("#ipAddress = " + cbObject.wired.ipAddress);
            log("#netmask = " + cbObject.wired.netmask);
            log("#gateway = " + cbObject.wired.gateway);
            log("#dns1 = " + cbObject.wired.dns1);
            log("cbObject.isInternetConnectionAvailable : " + cbObject.isInternetConnectionAvailable);
            log(" The Num2 key events are delivered to the HCAP app.");

            hideShow("getNetworkInfoSuccess", "inline");
        },
        "onFailure": function (err) {
            log("onFailure : errorMessage = " + err.errorMessage);
            hideShow("getNetworkInfoFail", "inline");
        }
    });
}

var previous_att = [1,1,1,1,1];
idcap.request( "idcap://system/key/reset" , {
    "parameters": {},
    "onSuccess": function () {
        console.log("onSuccess");
    },
    "onFailure": function (err) {
        console.log("onFailure : errorMessage = " + err.errorMessage);
    }
});

//Toggle attrebute of hcap.key.addKeyItem
function set_key_table(virtualKeycode) { 
    var vkey, attribute;
    switch (virtualKeycode) {
        case 1:vkey = "NUM_1"; break;
        case 2:vkey = "NUM_2"; break;
        case 3:vkey = "NUM_3"; break;
        case 4:vkey = "NUM_4"; break;
        default:vkey = "NUM_4"; break;
    }

    if(previous_att[virtualKeycode] === 0)
    {
        log(virtualKeycode + " key attribute = 2");
        log(" The Num" + virtualKeycode + " key events are delivered to the HCAP app.");
        previous_att[virtualKeycode] = attribute = 2;
    }    
    else
    {
        log(virtualKeycode + " key attribute = 0");
        log(" The Num" + virtualKeycode + " key events are processed by the TV.");
        previous_att[virtualKeycode] = attribute = 0;
    }

    idcap.request( "idcap://system/key/add" , {
        "parameters": {
            "keycode" : 0,
            "virtualKeycode" : vkey,
            "attribute" : attribute,
        },
        "onSuccess": function () {
            log("onSuccess");
        },
        "onFailure": function (err) {
            log("onFailure : errorMessage = " + err.errorMessage);
        }
    });

}

//Key event listener
document.addEventListener("keydown", onKeyDown , true);
function onKeyDown(event) {
    log('event.keyCode : ' + event.keyCode);
    switch (event.keyCode) {
        case idcap.key.Code.NUM_0:
            clearLogMsg();
            idcap.request( "idcap://system/key/reset" , {
                "parameters": {},
                "onSuccess": function () {
                    console.log("key reset onSuccess");
                },
                "onFailure": function (err) {
                    console.log("onFailure : errorMessage = " + err.errorMessage);
                }
            });
            break;
        case idcap.key.Code.NUM_1:
            setVolumeLevel(10);                                 //set Volume Level
            break;
        case idcap.key.Code.NUM_2:
            getNetworkInfo();                                   //get network info
            break;
        case idcap.key.Code.NUM_5: set_key_table(1);break;
        case idcap.key.Code.NUM_6: set_key_table(2);break;
        case idcap.key.Code.PORTAL:
            window.location.href = "";                          //restart app
            break;
        default:
            break;
    }
}


