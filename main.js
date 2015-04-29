/* global STXRtc, Zepto, AWS */
/* exported connect, disconnect, enableServerLogging */
/* jshint devel:true */

/* jshint newcap:false */
Zepto(function($) {

    // This value should be updated to represent your own Cognito
    // user pool ID.
    var cognitoPoolId = "us-east-1:90307bbf-83d6-46c0-843d-3048f89b4b6d";

    // And this value represents your SQS Queue URL
    var queueURL = "https://sqs.us-east-1.amazonaws.com/413659487904/clients";

    // The current survey version
    var surveyVersion = '1';

    // Initialize the Amazon Cognito credentials provider
    AWS.config.region = 'us-east-1';
    AWS.config.credentials = new AWS.CognitoIdentityCredentials({
        IdentityPoolId: cognitoPoolId,
    });

    var sessionID;

    var stxRtc = new STXRtc() ;
    var logger= stxRtc.getLogger();

    var sqs = new AWS.SQS();

    var signinContainer = $('#signin-container');
    var connectingContainer = $('#connecting-container');
    var streamContainer = $('#stream-container');
    var surveyContainer = $('#survey-container');
    var errorText = $('.error-text');
    var browserSupported = true;

    var connectButton = $('#connect');

    var turnIP,turnUser,turnPass;

    streamContainer.hide();
    connectingContainer.hide();

    logger.setLogLevel(logger.VERBOSE);
    function enableServerLogging(level) {
        stxRtc.setServerLogLevel(level);
    }

    function showSigninContainer() {
        signinContainer.show();
        streamContainer.hide();
        connectingContainer.hide();
        connectButton.prop("disabled",false);
        surveyContainer.hide();
    }

    function presentSurvey() {
        surveyContainer.show().css("display","flex");
        signinContainer.hide();
        streamContainer.hide();
        connectingContainer.hide();
    }

    function submitSurvey() {
        try {
            var selected = $('input[name=experience]:checked');

            var selValue,selName;

            if (selected) {
                selValue = selected.val();
                selName = selected.attr('valueword');
            }
            var otherComments = $('#other-comments').val();

            var surveyValues = {
                'EXPERIENCE': selName
            };

            var metrics = {};

            if (selValue) {
                metrics['EXPERIENCE_VALUE']= Number(selValue);
                surveyValues["EXPERIENCE_VALUE"] = metrics['EXPERIENCE_VALUE'];
            }

            if (stxRtc.sessionID) {
                surveyValues["SESSION_ID"] = stxRtc.sessionID;
            }

            surveyValues["OTHER_COMMENTS"]= otherComments || "[none]";

            var params = {
              MessageBody: JSON.stringify(surveyValues),
              QueueUrl: queueURL, /* required */
              DelaySeconds: 0,
              MessageAttributes: {
                surveyVersion: {
                  DataType: 'Number', /* required */
                  StringValue: surveyVersion
                }
              }
            };
            sqs.sendMessage(params, function(err, data) {
              if (err) {
                  logger.error(err, err.stack); // an error occurred
              } else {
                  logger.info("Sent SMS",data);           // successful response
              }
            });
        } catch (e) {
            logger.error("Error submitting survey: "+e);
        }

        showSigninContainer();
    }

    var unloading = false;
    window.onbeforeunload = function() {
        unloading = true;
        stxRtc.disconnect() ;
    };

    function onDisconnect(error,wasStreaming) {
        if (error) {
            $('.error-text').html(error).show();

            if (wasStreaming && !unloading) {
                presentSurvey();
            } else {
                showSigninContainer();
            }
        } else {
            presentSurvey();
        }
    }

    function onConnected() {
        connectingContainer.hide();
        logger.info("Main.js received onConnected");
        //This will close the window after 1 minute
        setTimeout(function(){alert("Session Ending! Thank You!"); disconnect()},60000);
    }

    stxRtc.onDisconnect = onDisconnect;
    stxRtc.onConnected = onConnected;

    function disconnect() {
        stxRtc.disconnect();
    }

    function showError(error) {
        errorText.html(error).show();
    }

    function connect() {

        errorText.hide();

        connectButton.prop("disabled",true);
        signinContainer.hide();
        streamContainer.show();
        surveyContainer.hide();
        connectingContainer.show();

        if ($('#standalone-inputs').hasClass('active')) {

            var server = $("#standalone-url").val();

            if (server.length===0) {
                showError("You need to enter a Quick Link.");
                showSigninContainer();
                return;
            }

            // If (and only if!) we're an ssm: URL it needs a TURN configuration
            // to be passed in as part of the URL.
            if ( server.indexOf("ssm:")===0 ) {
                // If there are no params already, use a "?", else a "&"
                if (server.indexOf("?")===-1) {
                    server += "?";
                } else {
                    server += "&";
                }
                server += String.simpleformat("turnIP={0}&turnUser={1}&turnPass={2}&sessionID={3}",
                                              encodeURIComponent(turnIP),
                                              encodeURIComponent(turnUser),
                                              encodeURIComponent(turnPass),
                                              encodeURIComponent(sessionID));
            }

            stxRtc.connect({ server:server });
        } else { // DES
            var url = $('#entitlement-url').val();
            var appId = $('#application-id').val();
            var userName = $('#identity-token').val();

            if (url.length===0) {
                showError("You need to enter an Entitlement service URL or IP address");
                showSigninContainer();
                return;
            }

            if (appId.length===0) {
                showError("You need to enter an Application ID");
                showSigninContainer();
                return;
            }

            if (userName.length===0) {
                showError("You need to enter a user name");
                showSigninContainer();
                return;
            }

            if (url.substr(0, 4) !== 'http') {
                url = 'http://' + url;
            }
            $.ajax({
                url: url + '/api/entitlements/' + appId,
                type: 'POST',
                dataType: 'text',
                data: 'terminatePrevious=true',
                headers: {
                    'Authorization': 'Username' + userName
                },
                success: function(data) {
                    logger.verbose("DES returned:",data);

                    stxRtc.connect({ server:data });
                },
                error: function(xhr,errorType,error) {
                    if (xhr.status === 0) {
                        // "Zero" statuses are network errors that happen before the HTTP transaction completes,
                        // or they're CORS failures.
                        showError("A server with the specified hostname could not be found, or the server doesn't have <a href='https://developer.mozilla.org/en-US/docs/Web/HTTP/Access_control_CORS'>CORS</a> enabled.");
                    }
                    else {
                        showError(xhr.responseText + ' [' + xhr.status + '] '+error);
                    }
                    showSigninContainer();
                }
            });

        }
    }

    function parseQuery() {

        var str = window.location.search;
        var objURL = {};

        str.replace(
            new RegExp( "([^?=&]+)(=([^&]*))?", "g" ),
            function( $0, $1, $2, $3 ){
                objURL[ $1 ] = $3;
            }
        );
        return objURL;
    }

    var params = parseQuery();

    var thisURL= window.location;

    var serverURL = params['server'] ;
    turnIP = params['turn'] || thisURL.hostname + ":34780";
    sessionID = params['session'] || "9070-0";

    var userID = params['user'] || "";
    var des = params['des'] || "";
    var appID = params['appid'] || "";
    var doConnect = params['connect'] || false;

    var entitlement_url = params['entitlementUrl'];

    if (sessionID.length > 36) {
        sessionID = sessionID.substr(0, 36);
    } else {
        while (sessionID.length < 36) {
            sessionID += "+";
        }
    }
    sessionID += "-client";

    function enableStandalone() {
        if (browserSupported) {
            errorText.hide();
        }
        $('#standalone-inputs').addClass('active');
        $('#entitlement-inputs').removeClass('active');

        $('#standalone-tab').addClass('active').one('transitioned', function() {
            $('#standalone-tab').css('display','none');
        });
        $('#entitlement-tab').css('display', 'block').removeClass('active');
    }

    function enableEntitlement() {
        if (browserSupported) {
            errorText.hide();
        }
        $('#standalone-inputs').removeClass('active');
        $('#entitlement-inputs').addClass('active');

        $('#standalone-tab').css('display', 'block').removeClass('active');
        $('#entitlement-tab').addClass('active').one('transitioned', function() {
            $('#entitlement-tab').css('display','none');
        });
    }

    // signin tab handlers
    $('.signin-types .tab').on('click', function(e) {
        if ($(e.currentTarget).is('#standalone-tab')) {
            enableStandalone();
        } else {
            enableEntitlement();
        }
    });

    if (serverURL && serverURL.length>0) {
        $('#standalone-url').val(serverURL);
    }

    $('#application-id').val(appID);
    $('#entitlement-url').val(des);
    $('#identity-token').val(userID);

    $('#verboseServerLogs').on("click",function(){ enableServerLogging(logger.VERBOSE); } );
    $('#errorServerlogs').on("click",function(){ enableServerLogging(logger.ERROR); } );
    $('#fullscreen').on("click",function(){ stxRtc.toggleFullScreen(); } );

    $('#connect').on("click",connect);
    $('#stx-signout').on("click",disconnect);

    $('#submit-survey').on("click",submitSurvey);

    try {
        stxRtc.browserCheck();

        // If we're here, then it's OK to connect...
        if (entitlement_url) {
            $('#standalone-url').val(entitlement_url);
            connect();
        } else if (doConnect) {
            enableEntitlement();
            connect();
        }
    } catch (errorMessage) {
        showError(errorMessage);
        connectButton.prop("disabled",true);
        browserSupported = false;
    }

});
