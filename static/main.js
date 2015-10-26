window.onload = () => {
'use strict';

let $ = document.getElementById.bind(document);

let switchMainPanelMode = (mode) => {
  let controls = ['uninitialized', 'disconnected', 'join', 'connected'].map(
      (prefix) => {
        let element = $(prefix + 'Controls');
        if (element)
          element.style.display = (prefix === mode) ? 'block' : 'none';
      });
};

let localStream = null;
let localPeer = null;
let remotePeers = [];

switchMainPanelMode('uninitialized');

navigator.webkitGetUserMedia({ video: true },
    (stream) => {
      localStream = stream;
      let video = $('localVideo');
      video.src = URL.createObjectURL(stream);
      video.play();

      let channelId = window.location.hash.substr(1);
      if (channelId === '')
        hangUp();
      else
        joinChannel(channelId);
    },
    (error) => {
      console.error('Unable to get stream: ', error);
    });

$('startButton').onclick = () => {
  let id = (Math.random() * 1000000000) | 0;
  joinChannel(id);
};

$('showJoinButton').onclick = () => {
  switchMainPanelMode('join');
  $('channelId').focus();
};

$('joinButton').onclick = () => joinChannel($('channelId').value);
$('joinCancelButton').onclick = () => switchMainPanelMode('disconnected');

$('chatMessage').onkeypress = (e) => {
  if (e.keyCode === 13)
    $('chatSendButton').click();
};

$('chatSendButton').onclick = () => {
  let message = $('chatMessage').value;
  $('chatMessage').value = '';
  // TODO: implement
  console.log('SEND TEXT: ', message);
};

$('hangupButton').onclick = () => hangUp();

let joinChannel = (channelId) => {
  localPC
};

let hangUp = () => {
  switchMainPanelMode('disconnected');
};

};

let onCallClicked = () => {
  callButton().disabled = true;
  hangupButton().disabled = false;

  let localPC = new webkitRTCPeerConnection(null);
  let remotePC = new webkitRTCPeerConnection(null);

  localPC.onicecandidate = (e) => {
    if (e.candidate)
      remotePC.addIceCandidate(new RTCIceCandidate(e.candidate));
  };

  let sendChannel = localPC.createDataChannel('sendDataChannel', {});
  sendChannel.onopen = () => {
    dataChannelSend().disabled = false;
    dataChannelSend().focus();
    dataChannelSend().placeholder = '';
    sendButton().disabled = false;
  };
  sendChannel.onclose = () => { dataChannelSend().disabled = true; };

  remotePC.onicecandidate = (e) => {
    if (e.candidate)
      localPC.addIceCandidate(new RTCIceCandidate(e.candidate));
  };

  remotePC.onaddstream = (e) => {
    remoteVideo().src = URL.createObjectURL(e.stream);
  };

  remotePC.ondatachannel = (e) => {
    e.channel.onmessage = (e) => { dataChannelReceive().value = e.data; };
  };

  localPC.addStream(localStream);
  localPC.createOffer((description) => {
        localPC.setLocalDescription(description);
        remotePC.setRemoteDescription(description);
        remotePC.createAnswer((description) => {
          remotePC.setLocalDescription(description);
          localPC.setRemoteDescription(description);
        });
      },
      (error) => {
        console.log(error);
      });

  terminateCall = () => {
    localPC.close();
    remotePC.close();
    sendChannel.close();
  };

  saySomething = () => { sendChannel.send(dataChannelSend().value); };
};

/*
let createIceService = function(urlString, username, password) {
  let url = new URL(urlString);
  if (url.protocol === 'stun:') {
    return { 'url': url.toString() };
  } else if (url.protocol === 'turn:') {
    return {
      'url': url.toString(),
      'username': username,
      'credential': password
    };
  }
};
*/
