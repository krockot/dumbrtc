'use strict';

let randomId = () => (Math.random() * 100000000) | 0;
let selectChannel = (id) => { document.body.innerText = id; };
let updateChannel = () => { selectChannel(window.location.hash.substr(1)); };

window.addEventListener('hashchange', updateChannel);

window.addEventListener('load', () => {
  if (window.location.hash === '#' || window.location.hash === '')
    window.location.hash = '#' + randomId();
  else
    updateChannel();
});

