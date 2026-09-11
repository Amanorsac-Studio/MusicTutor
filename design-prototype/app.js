const pages = [...document.querySelectorAll('.page')];
const navItems = [...document.querySelectorAll('.nav-item')];

navItems.forEach(button => button.addEventListener('click', () => {
  navItems.forEach(item => item.classList.toggle('active', item === button));
  pages.forEach(page => page.classList.toggle('active', page.id === button.dataset.page));
}));

document.querySelectorAll('.scene-card').forEach(card => card.addEventListener('click', () => {
  document.querySelectorAll('.scene-card').forEach(item => item.classList.toggle('active', item === card));
  document.querySelector('.program-stage').dataset.activeScene = card.dataset.scene;
}));

document.querySelectorAll('.switch').forEach(button => button.addEventListener('click', () => button.classList.toggle('on')));
document.querySelectorAll('.segmented button').forEach(button => button.addEventListener('click', () => {
  button.parentElement.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
}));

const piano = document.querySelector('#piano');
const notes = Array.from({length: 88}, (_, index) => index + 21);
const blackPitchClasses = new Set([1, 3, 6, 8, 10]);
const whiteNotes = notes.filter(note => !blackPitchClasses.has(note % 12));
const whitePositions = new Map();
let whiteIndex = -1;

notes.forEach(note => {
  if (!blackPitchClasses.has(note % 12)) whiteIndex += 1;
  else whitePositions.set(note, whiteIndex + .68);
});

const whiteRow = document.createElement('div');
whiteRow.className = 'white-keys';
whiteNotes.forEach(note => {
  const key = document.createElement('button');
  key.className = 'piano-key white';
  key.ariaLabel = `MIDI note ${note}`;
  if (note % 12 === 0) key.innerHTML = `<small>C${Math.floor(note / 12) - 1}</small>`;
  whiteRow.appendChild(key);
});
piano.appendChild(whiteRow);

notes.filter(note => blackPitchClasses.has(note % 12)).forEach(note => {
  const key = document.createElement('button');
  key.className = 'piano-key black';
  key.ariaLabel = `MIDI note ${note}`;
  key.style.left = `calc(${(whitePositions.get(note) / 52) * 100}% - .56%)`;
  piano.appendChild(key);
});

document.querySelectorAll('.piano-key').forEach(key => {
  const toggle = value => key.classList.toggle('active', value);
  key.addEventListener('pointerdown', () => toggle(true));
  key.addEventListener('pointerup', () => toggle(false));
  key.addEventListener('pointerleave', () => toggle(false));
});

const channels = [
  ['M1', 'Vocal mic', 'IN 1', 71], ['M2', 'Room mic', 'IN 2', 23],
  ['P1', 'Stage piano', 'IN 3–4', 57], ['VI', 'Instrument', 'Grand piano', 64],
  ['AV', 'Camera audio', 'Camera 1', 36], ['FX', 'Music bed', 'Playback', 49],
  ['Σ', 'Master', 'Main output', 76],
];

const consoleElement = document.querySelector('#console');
channels.forEach(([short, name, detail, value], index) => {
  const channel = document.createElement('article');
  channel.className = `channel${index === channels.length - 1 ? ' master' : ''}`;
  channel.innerHTML = `<span class="channel-label">${short}</span><h3>${name}</h3><small>${detail}</small><div class="channel-meter"><i style="height:${value}%"></i></div><input class="fader" aria-label="${name} volume" type="range" value="${value}"><span class="channel-output">${Math.round((value - 100) * .42)}.0 dB</span><div class="channel-buttons"><button>M</button><button>S</button></div>`;
  const fader = channel.querySelector('.fader');
  const meter = channel.querySelector('.channel-meter i');
  const output = channel.querySelector('.channel-output');
  fader.addEventListener('input', () => {
    meter.style.height = `${fader.value}%`;
    output.textContent = `${Math.round((Number(fader.value) - 100) * .42)}.0 dB`;
  });
  channel.querySelectorAll('.channel-buttons button').forEach(button => button.addEventListener('click', () => button.classList.toggle('active')));
  consoleElement.appendChild(channel);
});

const recordButton = document.querySelector('.record-button');
const readyState = document.querySelector('.ready-state');
recordButton.addEventListener('click', () => {
  recordButton.classList.toggle('recording');
  readyState.innerHTML = recordButton.classList.contains('recording') ? '<i style="background:#d46b67"></i>Recording' : '<i></i>Ready';
});
