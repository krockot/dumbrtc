'use strict';

let randomId = () => (Math.random() * 100000000) | 0;
let updateChannel = () => { selectChannel(window.location.hash.substr(1)); };

let init = () => {
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

