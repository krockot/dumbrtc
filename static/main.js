'use strict';

let memoize = (fn) => {
  let cached = false;
  let value = null;
  return () => {
    if (cached)
      return value;
    cached = true;
    value = fn();
    return value;
  };
};

let lazyElement = (id) => memoize(() => document.getElementById(id));
let startButton = lazyElement('startButton');
let callButton = lazyElement('callButton');
let hangupButton = lazyElement('hangupButton');
let sendButton = lazyElement('sendButton');
let localVideo = lazyElement('localVideo');
let remoteVideo = lazyElement('remoteVideo');
let dataChannelSend = lazyElement('dataChannelSend');
let dataChannelReceive = lazyElement('dataChannelReceive');

let localStream = null;
let terminateCall = () => {};
let saySomething = () => {};

let randomId = () => (Math.random() * 100000000) | 0;
let updateChannel = () => { selectChannel(window.location.hash.substr(1)); };

let init = () => {
  startButton().disabled = false;
  callButton().disabled = true;
  hangupButton().disabled = true;
  startButton().onclick = onStartClicked;
  callButton().onclick = onCallClicked;
  hangupButton().onclick = onHangupClicked;
  sendButton().onclick = onSendClicked;
  if (window.location.hash === '#' || window.location.hash === '')
    window.location.hash = '#' + randomId();
  else
    updateChannel();
};

window.addEventListener('hashchange', updateChannel);
window.addEventListener('load', init);

let selectChannel = (id) => {
  console.log('Switching to channel ' + id);
};

let onStartClicked = () => {
  startButton().disabled = true;
  navigator.webkitGetUserMedia({ video: true },
      (stream) => {
        localStream = stream;
        let video = localVideo();
        video.src = URL.createObjectURL(stream);
        video.play();
        video.style.transform = 'rotateY(180deg)';
        callButton().disabled = false;
      },
      (error) => {
        console.error('Unable to get stream: ', error);
      });
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

let onHangupClicked = () => {
  hangupButton().disabled = true;
  callButton().disabled = false;
  terminateCall();
};

let onSendClicked = () => { saySomething(); };

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
