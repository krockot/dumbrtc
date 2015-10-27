window.onload = () => {
'use strict';

let ENABLE_LOGGING = false;

let DEFAULT_ICE_SERVERS = [
  { url: 'stun:stun.l.google.com:19302' },
  { url: 'turn:oz.gs:3478', username: 'webrtc', credential: 'test' },
];

let DEFAULT_PEER_CONFIG = {
  'iceServers': DEFAULT_ICE_SERVERS,
};

let $ = document.getElementById.bind(document);
let log = (ENABLE_LOGGING ?
    function() { console.log.apply(console, arguments); } : () => {});

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
initializeLocalStream();

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

$('channelId').onkeypress = (e) => {
  if (e.keyCode === 13)
    $('joinButton').click();
};

$('chatMessage').onkeypress = (e) => {
  if (e.keyCode === 13)
    $('chatSendButton').click();
};

$('chatSendButton').onclick = () => {
  let message = $('chatMessage').value;
  $('chatMessage').value = '';
  postChatMessage('<strong>' + localPeerId + ':</strong> ' + message);
  Object.keys(knownPeers).forEach((peerId) => {
    let peer = knownPeers[peerId];
    if (peer.dataChannel !== null && peer.dataChannelReady)
      peer.dataChannel.send(message);
    else
      peer.dataQueue.push(message);
  });
};

$('hangupButton').onclick = () => hangUp();

let initializeLocalStream = () => {
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
        setTimeout(initializeLocalStream, 1000);
      });
};

let isConnected = () => localPeerId !== null && connectedChannelId !== null;

let nextRequestId = 0;
let issueBrokerRequest = (request) => {
  let requestId = ++nextRequestId;
  log('Issuing broker request of type ' + request.Operation + ' ('
      + requestId + ')');
  let xhr = new XMLHttpRequest;
  xhr.responseType = 'text';
  xhr.open('POST', '/broker');
  return new Promise((resolve, reject) => {
    xhr.onload = () => {
      log('Completed broker request ' + requestId);
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
    let peer = knownPeers[peerId];
    peer.connection.close();
    if (peer.dataChannel !== null)
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
        if (status.Candidates !== null)
          updateCandidates(status.Candidates)
        if (status.Offers !== null)
          updateOffers(status.Offers)
        if (status.Peers !== null)
          updatePeers(status.Peers)
        setTimeout(updateStatus, 2000);
      });
};

let updatePeers = (peers) => {
  peers.forEach((peerId) => {
    if (knownPeers.hasOwnProperty(peerId) || peerId <= localPeerId)
      return;

    log('Creating new local peer connection from peers list: ' + peerId);
    let localPeerConnection = new webkitRTCPeerConnection(DEFAULT_PEER_CONFIG);

    localPeerConnection.onicecandidate = (e) => {
      log('Local peer from peers list got ice candidate.');
      if (e.candidate)
        addIceCandidate(peerId, e.candidate);
    };

    localPeerConnection.onaddstream = (e) => {
      log('Local peer from peers list got a stream.');
      $('remoteVideo').src = URL.createObjectURL(e.stream);
    };

    localPeerConnection.addStream(localStream);
    let dataChannel = localPeerConnection.createDataChannel('chat');

    let peer = {
      connection: localPeerConnection,
      dataChannel: dataChannel,
      dataChannelReady: true,
      knownCandidates: {},
      hasAnswer: false,
      dataQueue: []
    };

    window.KP = knownPeers;
    dataChannel.onopen = () => {
      log('Opened data channel for peer ' + peerId);
      peer.dataChannelReady = true;
      peer.dataQueue.forEach((msg) => peer.dataChannel.send(msg));
      peer.dataQueue = [];
    };

    dataChannel.onclose = () => {
      log('Closed data channel for peer ' + peerId);
      peer.dataChannelReady = false;
    };

    dataChannel.onmessage = (e) => {
      postChatMessage('<strong>' + peerId + ':</strong> ' + e.data);
    };

    localPeerConnection.createOffer((description) => {
      log('Local peer from peers list created offer.');
      localPeerConnection.setLocalDescription(description);
      addOffer(peerId, description);
    });

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
    log('Got candidate for active peer ' + c.SourceID);
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
      log('Creating new local peer connection for offer from ' + peerId);
      let localPeerConnection =
          new webkitRTCPeerConnection(DEFAULT_PEER_CONFIG);

      localPeerConnection.onicecandidate = (e) => {
            log('Local peer connection from offer got a candidate');
            if (e.candidate)
              addIceCandidate(peerId, e.candidate);
          };

      localPeerConnection.onaddstream = (e) => {
            log('Local peer connection from offer got a stream');
            $('remoteVideo').src = URL.createObjectURL(e.stream);
          };

      let peer = {
        connection: localPeerConnection,
        dataChannel: null,
        dataChannelReady: false,
        knownCandidates: {},
        hasAnswer: false,
        dataQueue: []
      };

      localPeerConnection.ondatachannel = (e) => {
            log('Received datachannel from peer.');
            peer.dataChannel = e.channel;
            e.channel.onopen = (e) => {
              peer.dataChannelReady = true;
              peer.dataQueue.forEach((msg) => peer.dataChannel.send(msg));
              peer.dataQueue = [];
            }
            e.channel.onclose = (e) => { peer.dataChannelReady = false; }
            e.channel.onmessage = (e) => {
              postChatMessage('<strong>' + peerId + ':</strong> ' + e.data);
            };
          };

      knownPeers[peerId] = peer;

      localPeerConnection.setRemoteDescription(
          new RTCSessionDescription(description));
      localPeerConnection.addStream(localStream);

      localPeerConnection.createAnswer((description) => {
            log('Local peer connection created answer to offer.');
            localPeerConnection.setLocalDescription(description);
            peer.hasAnswer = true;
            addOffer(peerId, description);
          }, (error) => { throw error; });
    } else if (peerInfo && description.type === 'answer' &&
               !peerInfo.hasAnswer) {
      log('Received answer from peer ' + peerId, description);
      peerInfo.hasAnswer = true;
      peerInfo.connection.setRemoteDescription(
          new RTCSessionDescription(description));
    }
  });
};

let postChatMessage = (message) => {
  $('chatLog').innerHTML += '<p>' + message + '</p>';
};

};
