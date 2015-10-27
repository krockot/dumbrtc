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
let localPeerId = null;
let connectedChannelId = null;
let knownPeers = {};

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
  joinChannel(id.toString(16));
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

let isConnected = () => localPeerId !== null && connectedChannelId !== null;

let issueBrokerRequest = (request) => {
  let xhr = new XMLHttpRequest;
  xhr.responseType = 'text';
  xhr.open('POST', '/broker');
  return new Promise((resolve, reject) => {
    xhr.onload = () => {
      if (xhr.status === 200)
        resolve(JSON.parse(xhr.response));
      else
        reject('Broker request failed: ' + xhr.responseText);
    };
    xhr.onerror = (e) => { reject(e); };
    xhr.send(JSON.stringify(request));
  });
};

let joinChannel = (channelId) => {
  issueBrokerRequest({ Operation: 'join', ChannelID: channelId }).then(
      (response) => {
        if (isConnected()) {
          console.error('Already connected. Bailing.');
          return;
        }
        $('statusText').innerText = 'Connected to channel: ' + channelId;
        switchMainPanelMode('connected');
        connectedChannelId = channelId
        localPeerId = response.PeerID;
        updateStatus();
      });
};

let addIceCandidate = (targetId, candidate) => {
  issueBrokerRequest({
    Operation: 'add ice candidate',
    SourcePeerID: localPeerId,
    TargetPeerID: targetId,
    Candidate: {
      Label: candidate.sdpMLineIndex.toString(),
      ID: candidate.sdpMid,
      Candidate: candidate.candidate
    }
  });
};

let addOffer = (targetId, description) => {
  issueBrokerRequest({
    Operation: 'add offer',
    SourcePeerID: localPeerId,
    TargetPeerID: targetId,
    Offer: JSON.stringify(description)
  });
};

let hangUp = () => {
  Object.keys(knownPeers).forEach((peerId) => {
    let peer = knownPeers(peerId);
    peer.connection.close();
    peer.dataChannel.close();
  });
  localPeerId = null;
  connectedChannelId = null;
  knownPeers = {};
  switchMainPanelMode('disconnected');
};

let updateStatus = () => {
  issueBrokerRequest({
    Operation: 'get status',
    SourcePeerID: localPeerId,
    ChannelID: connectedChannelId })
      .then((status) => {
        if (!isConnected())
          return;
        updatePeers(status.Peers)
        if (status.Candidates !== null)
          updateCandidates(status.Candidates)
        if (status.Offers !== null)
          updateOffers(status.Offers)
        setTimeout(updateStatus, 2000);
      });
};

let updatePeers = (peers) => {
  if (!isConnected())
    return;
  peers.forEach((peerId) => {
    if (knownPeers.hasOwnProperty(peerId) || peerId <= localPeerId)
      return;

    let localPeerConnection = new webkitRTCPeerConnection(null);
    localPeerConnection.onicecandidate = (e) => {
      if (e.candidate)
        addIceCandidate(peerId, e.candidate);
    };
    localPeerConnection.addStream(localStream);
    localPeerConnection.createOffer((description) => {
      localPeerConnection.setLocalDescription(description);
      addOffer(peerId, description);
    });
    localPeerConnection.onaddstream = (e) => {
      console.log('Added stream!');
      $('remoteVideo').src = URL.createObjectURL(e.stream);
    };

    let dataChannel = localPeerConnection.createDataChannel('data', {});

    let peer = {
      connection: localPeerConnection,
      dataChannel: dataChannel,
      dataChannelReady: false,
      knownCandidates: {},
      hasAnswer: false
    };

    dataChannel.onopen = () => { peer.dataChannelReady = true; };
    dataChannel.onclose = () => { peer.dataChannelReady = false; };

    knownPeers[peerId] = peer;
  });
};

let updateCandidates = (candidates) => {
  candidates.forEach((c) => {
    if (!knownPeers.hasOwnProperty(c.SourceID))
      return;
    let peerInfo = knownPeers[c.SourceID];
    if (peerInfo.knownCandidates.hasOwnProperty(c.Candidate) ||
        !peerInfo.hasAnswer)
      return;
    peerInfo.knownCandidates[c.Candidate] = c;
    peerInfo.connection.addIceCandidate(new RTCIceCandidate({
      candidate: c.Candidate,
      sdpMLineIndex: parseInt(c.Label)
    }));
  });
};

let updateOffers = (offers) => {
  offers.forEach((offer) => {
    let description = JSON.parse(offer.Offer);
    let peerId = offer.SourceID;
    let peerInfo = (knownPeers.hasOwnProperty(peerId)
        ? knownPeers[peerId] : null);
    if (!peerInfo && description.type === 'offer') {
      let localPeerConnection = new webkitRTCPeerConnection(null);
      localPeerConnection.onicecandidate = (e) => {
        if (e.candidate)
          addIceCandidate(peerId, e.candidate);
      };
      localPeerConnection.addStream(localStream);
      localPeerConnection.onaddstream = (e) => {
        console.log('Added stream!');
        $('remoteVideo').src = URL.createObjectURL(e.stream);
      };
      let peer = {
        connection: localPeerConnection,
        dataChannel: null,
        dataChannelReady: false,
        knownCandidates: {},
        hasAnswer: false,
      };
      localPeerConnection.ondatachannel = (e) => {
        peer.dataChannel = e.channel;
        e.channel.onopen = (e) => { peer.dataChannelReady = true; }
        e.channel.onclose = (e) => { peer.dataChannelReady = false; }
      };
      localPeerConnection.setRemoteDescription(
          new RTCSessionDescription(description));
      localPeerConnection.createAnswer((description) => {
        localPeerConnection.setLocalDescription(description);
        peer.hasAnswer = true;
        addOffer(peerId, description);
      }, (error) => {
        throw error;
      });
      knownPeers[peerId] = peer;
      console.log('Holding onto offer from peer ', peer);
    } else if (peerInfo && description.type === 'answer' &&
               !peerInfo.hasAnswer) {
      console.log('Received answer from peer: ', description);
      peerInfo.hasAnswer = true;
      peerInfo.connection.setRemoteDescription(
          new RTCSessionDescription(description));
    }
  });
};

};

/* TODO:

 handle peer connection:
   onicecandidate: pc.addIceCandidate(new RTCIceCandidate(e.candidate))
   onaddstream: create video with src=URL.createObjectURL(e.stream)
   dataChannel.onmessage get from e.data

 send chat with dataChannel.send

 on offer:
   createAnswer((desc) => ...);
};

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
