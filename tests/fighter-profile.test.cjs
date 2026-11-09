const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const dataSource = fs.readFileSync(path.join(root, 'fighters-data.js'), 'utf8');
const profileHtml = fs.readFileSync(path.join(root, 'fighter.html'), 'utf8');
const renderer = [...profileHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .find(script => script.includes('function initFighterProfile'));
assert.ok(renderer, 'The profile renderer must be present in fighter.html');

function loadFighters() {
  const events = [];
  const window = { dispatchEvent(event) { events.push(event.type); } };
  vm.runInNewContext(dataSource, {
    window,
    CustomEvent: class { constructor(type) { this.type = type; } },
  }, { filename: 'fighters-data.js' });
  return { fighters: JSON.parse(JSON.stringify(window.SC1_FIGHTERS)), events };
}

// Only the DOM methods used by the inline renderer are needed here. Rejecting
// HTML writes catches accidental interpolation of fighter-supplied text.
class Element {
  constructor(tagName, attributes = '') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.hidden = /\bhidden\b/.test(attributes);
    this.className = '';
    this._text = '';
    this.attributes = new Map();
    this.listeners = new Map();
    for (const match of attributes.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
      this.setAttribute(match[1], match[2] || '');
    }
    const styles = new Map();
    this.style = {
      setProperty(name, value) { styles.set(name, String(value)); },
      getPropertyValue(name) { return styles.get(name) || ''; },
    };
  }

  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_value) { throw new Error('Use textContent or DOM nodes, not innerHTML, for fighter data'); }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this._text = ''; this.children = [...nodes]; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
    else if (name !== 'hidden') this[name] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, callback, options = {}) { this.listeners.set(type, { callback, once: options.once }); }
  dispatch(type) {
    const listener = this.listeners.get(type);
    if (!listener) return;
    if (listener.once) this.listeners.delete(type);
    listener.callback();
  }
  focus(options) { this.focusOptions = options; }
}

function render(fighters, search, { deferred = false } = {}) {
  const nodes = new Map();
  for (const match of profileHtml.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>([^<]*)/gi)) {
    const node = new Element(match[1], match[2]);
    node.textContent = match[4].trim();
    nodes.set(match[3], node);
  }
  const listeners = new Map();
  const document = {
    title: '',
    createElement(tagName) { return new Element(tagName); },
    createElementNS(namespace, tagName) {
      const node = new Element(tagName);
      node.namespaceURI = namespace;
      return node;
    },
    getElementById(id) {
      assert.ok(nodes.has(id), `Renderer refers to missing HTML id: ${id}`);
      return nodes.get(id);
    },
  };
  const window = {
    location: { search },
    addEventListener(type, callback) { listeners.set(type, callback); },
  };
  if (!deferred) window.SC1_FIGHTERS = fighters;
  vm.runInNewContext(renderer, { window, document, URL, URLSearchParams }, { filename: 'fighter.html:inline-profile' });
  return {
    node: id => document.getElementById(id),
    document,
    deliverData() {
      window.SC1_FIGHTERS = fighters;
      assert.ok(listeners.has('sc1:fighters-ready'));
      listeners.get('sc1:fighters-ready')();
    },
  };
}

function facts(view) {
  return Object.fromEntries(view.node('profile-stats').children.map(node => {
    const copy = node.children[1];
    return [copy.children[0].textContent, copy.children[1].textContent];
  }));
}

function winRows(view) {
  return view.node('profile-win-by').children.map(row => {
    assert.equal(row.tagName, 'LI');
    assert.equal(row.children.length, 4);
    assert.equal(row.children[0].getAttribute('aria-hidden'), 'true');
    return row.children.slice(1).map(node => node.textContent);
  });
}

function assertMeter(view, label, rating) {
  const row = view.node('profile-fan-reaction').children.find(item => item.children[1].children[0].textContent === label);
  assert.ok(row, `${label} reaction exists`);
  const [meter, value] = row.children[1].children[1].children;
  assert.equal(row.children[0].tagName, 'SVG');
  assert.equal(row.children[0].getAttribute('aria-hidden'), 'true');
  assert.equal(value.textContent, rating === null ? 'NA' : `${rating} / 10`);
  assert.equal(meter.getAttribute('role'), rating === null ? 'img' : 'meter');
  assert.equal(meter.getAttribute('aria-label'), rating === null ? `${label}: Not available` : label);
  assert.equal(meter.getAttribute('aria-valuenow'), rating === null ? null : String(rating));
  assert.equal(meter.getAttribute('aria-valuemin'), rating === null ? null : '0');
  assert.equal(meter.getAttribute('aria-valuemax'), rating === null ? null : '10');
  assert.equal(meter.children.length, 10);
  meter.children.forEach((segment, index) => {
    assert.equal(segment.getAttribute('aria-hidden'), 'true');
    const fill = rating === null ? 0 : Math.max(0, Math.min(1, rating - index)) * 100;
    assert.equal(segment.style.getPropertyValue('--segment-fill'), `${fill}%`);
  });
}

function assertUnknownWins(view) {
  assert.deepEqual(winRows(view), [
    ['KO / TKO', 'NA', 'NA'], ['Submission', 'NA', 'NA'], ['Opponent forfeit', 'NA', 'NA'],
  ]);
  assert.equal(view.node('profile-win-chart').style.getPropertyValue('--win-chart'), '#292929');
}

function assertBloodDrop() {
  assert.match(profileHtml, /<svg class="profile-blood-drop"/);
  assert.doesNotMatch(profileHtml, /id="profile-win-rate"|id="profile-win-total"/);
}

function assertPhotoTrigger(button, photo, index, total) {
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.className, 'profile-photo-trigger');
  assert.equal(button.type, 'button');
  assert.equal(button.getAttribute('data-photo-index'), String(index));
  assert.equal(button.getAttribute('data-full-src'), photo.fullSrc || photo.src);
  assert.equal(button.getAttribute('aria-label'), `Open photo ${index + 1} of ${total}: ${photo.alt}`);
  assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(button.children.length, 1);
  const image = button.children[0];
  assert.equal(image.tagName, 'IMG');
  assert.equal(image.className, 'profile-photo');
  assert.equal(image.src, photo.src);
  assert.equal(image.alt, photo.alt);
  assert.equal(image.loading, 'lazy');
}

function fixture(overrides = {}) {
  return {
    slug: 'test-fighter', name: 'Test Fighter', nickname: 'The Example',
    realName: 'Example Name', record: '2–0', country: 'Sweden', height: '180 cm',
    weight: '77 kg', weightClass: '', age: '', fightingBackground: 'Boxing', affiliation: 'Example gym',
    knownFor: 'Footwork',
    bio: 'A test biography.', portrait: 'assets/fighters/hawk/testbild.jpeg',
    instagram: 'https://www.instagram.com/example/',
    winBy: { koTko: 0, submission: 2, opponentForfeit: null },
    fanReaction: { love: 0, hate: 6 },
    photos: [{ src: 'assets/fighters/hawk/testbild.jpeg', alt: 'Example gallery photo' }],
    videos: [{ title: 'Example fight', youtubeId: 'k3VHu0-hpQ0' }],
    ...overrides,
  };
}

test('fighter data keeps the single SC1Simon profile with verified record, media and stats', () => {
  const { fighters, events } = loadFighters();
  assert.deepEqual(events, ['sc1:fighters-ready']);
  assert.deepEqual(fighters.map(fighter => fighter.slug), ['sc1simon']);

  const textFields = ['nickname', 'realName', 'record', 'country', 'height', 'weight',
    'weightClass', 'age', 'fightingBackground', 'affiliation', 'knownFor', 'bio', 'instagram'];
  for (const fighter of fighters) {
    assert.match(fighter.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(fighter.name.trim());
    assert.equal(Object.hasOwn(fighter, 'stance'), false, 'Stance is removed from the data');
    for (const field of textFields) {
      assert.equal(typeof fighter[field], 'string', `${fighter.slug}.${field} is a text field`);
    }
    if (fighter.portrait) assert.ok(fs.existsSync(path.join(root, fighter.portrait)));
  }
  const [simon] = fighters;
  const simonProfile = {
    name: 'SC1SIMON', realName: 'Simon Ljungberg', record: '2–0', country: 'Sweden',
    height: '182 cm', weight: '81 kg', fightingBackground: 'Street/MMA', affiliation: 'Cleanup Crew',
    knownFor: 'Creating SC1 and also participating in it.',
    instagram: 'https://www.instagram.com/sc1simon/',
  };
  for (const [field, value] of Object.entries(simonProfile)) assert.equal(simon[field], value);
  assert.ok(simon.bio.includes('ground and pound'), 'The profile includes its biography');
  assert.deepEqual(simon.winBy, { koTko: 2, submission: 0, opponentForfeit: 0 });
  assert.deepEqual(simon.fanReaction, { love: 7, hate: 5 });
  assert.equal(simon.portrait, 'assets/fighters/sc1simon/simonpf.jpeg');
  assert.equal(simon.photos.length, 8, 'Alla bilder i sc1simon-mappen är inkopplade');
  assert.equal(simon.photos[0].src, simon.portrait);
  assert.deepEqual(simon.videos.map(video => video.youtubeId),
    ['fT3uTLo4v2I', 'naG-tE_PeZs', 'iLQqvBBUJ8g', 'QeH_ZdZzzMQ', 'THVvHvrhd3g']);
  assert.equal(simon.videos.length, 5, 'Both face-offs and both fights are listed');
});

for (const slug of ['sc1simon']) {
  test(`${slug} renders Record as its sixth fact, profile values, and the fight videos`, () => {
    const { fighters } = loadFighters();
    const fighter = fighters.find(item => item.slug === slug);
    const view = render(fighters, `?fighter=${slug}`);
    assert.equal(view.document.title, `${fighter.name} | SC1 Fighter`);
    assert.equal(view.node('fighter-profile').hidden, false);
    assert.equal(view.node('profile-not-found').hidden, true);
    assert.equal(view.node('profile-name').textContent, fighter.name);
    assert.equal(view.node('profile-real-name-value').textContent, fighter.realName || 'NA');
    assert.equal(view.node('profile-signature-subtitle').textContent, 'HOW THEY FIGHT');
    assert.equal(view.node('profile-signature-copy').textContent, fighter.bio);
    assert.equal(view.node('profile-known-for').textContent, fighter.knownFor || 'NA');
    assert.deepEqual(winRows(view), [
      ['KO / TKO', '100%', '(2)'], ['Submission', '0%', '(0)'], ['Opponent forfeit', '0%', '(0)'],
    ]);
    assert.equal(view.node('profile-win-chart').style.getPropertyValue('--win-chart'),
      'conic-gradient(#ff1835 0% 100%)');
    assert.match(view.node('profile-win-chart').getAttribute('aria-label'), /Win rate: 100%, 2 wins in 2 fights/);
    assertBloodDrop(view);
    assertMeter(view, 'Love', 7);
    assertMeter(view, 'Hate', 5);
    assert.equal(view.node('profile-social').hidden, false);
    assert.equal(view.node('profile-social').href, 'https://www.instagram.com/sc1simon/');
    assert.equal(view.node('profile-social-label').textContent, '@sc1simon');
    assert.equal(view.node('profile-social')['aria-label'], 'Instagram: @sc1simon (opens in a new tab)');
    assert.deepEqual(facts(view), {
      Representing: 'Sweden', Height: '182 cm', 'Last fight weight': '81 kg',
      'Fighting background': 'Street/MMA', Affiliation: 'Cleanup Crew', Record: '2–0',
    });
    assert.equal(view.node('profile-stats').children[5].children[1].children[0].textContent, 'Record');
    const expectedIcons = ['country-sweden', 'height', 'weight', 'fist', 'affiliation', 'record'];
    const iconsSource = fs.readFileSync(path.join(root, 'assets/fighter-icons.svg'), 'utf8');
    view.node('profile-stats').children.forEach((stat, index) => {
      const icon = stat.children[0];
      assert.equal(icon.tagName, 'SVG');
      assert.equal(icon.namespaceURI, 'http://www.w3.org/2000/svg');
      assert.equal(icon.getAttribute('aria-hidden'), 'true');
      assert.equal(icon.getAttribute('focusable'), 'false');
      assert.equal(icon.children[0].getAttribute('href'), `assets/fighter-icons.svg#${expectedIcons[index]}`);
      assert.ok(iconsSource.includes(`id="${expectedIcons[index]}"`));
    });
    assert.doesNotMatch(profileHtml, /\bid="profile-record"/, 'No duplicate Record remains in the hero');
    assert.doesNotMatch(renderer, /fighter\.stance/, 'Stance is no longer rendered');
    const photo = view.node('profile-photos').children[0];
    if (fighter.portrait) {
      const expectedPhotos = fighter.photos.length ? fighter.photos : [
        { src: fighter.portrait, alt: `${fighter.name} official portrait` },
      ];
      assert.equal(view.node('profile-photos').children.length, expectedPhotos.length);
      assertPhotoTrigger(photo, expectedPhotos[0], 0, expectedPhotos.length);
      assert.equal(view.node('profile-visual').children[0].src, fighter.portrait);
    } else {
      assert.equal(photo.className, 'profile-media-empty');
      assert.equal(photo.textContent, '');
    }
    assert.equal(view.node('profile-videos').children.length, fighter.videos.length);
    const video = view.node('profile-videos').children[0];
    const media = video.children[0];
    const play = media.children[0];
    assert.equal(play.tagName, 'BUTTON');
    assert.equal(play.getAttribute('aria-label'), 'Play ' + fighter.videos[0].title);
    assert.equal(play.children[0].src, 'https://i.ytimg.com/vi/fT3uTLo4v2I/hqdefault.jpg');
    play.dispatch('click');
    assert.equal(media.children[0].tagName, 'IFRAME');
    assert.equal(media.children[0].src, 'https://www.youtube-nocookie.com/embed/fT3uTLo4v2I?autoplay=1&playsinline=1&rel=0');
    assert.equal(video.children[1].textContent, fighter.videos[0].title);
    assert.equal(video.children[2].href, 'https://www.youtube.com/watch?v=fT3uTLo4v2I');
    assert.equal(video.children[2].rel, 'noopener noreferrer');
  });
}

test('unknown and missing fighter slugs show the not-found panel', () => {
  const { fighters } = loadFighters();
  for (const query of ['', '?fighter=does-not-exist']) {
    const view = render(fighters, query);
    assert.equal(view.node('fighter-profile').hidden, true);
    assert.equal(view.node('profile-not-found').hidden, false);
    assert.equal(view.node('profile-stats').children.length, 0);
  }
});

test('populated profile fields render real zero counts and ratings, not NA', () => {
  const fighter = fixture();
  const view = render([fighter], '?fighter=TEST-FIGHTER');
  assert.equal(view.node('profile-real-name-value').textContent, fighter.realName);
  assert.equal(view.node('profile-signature-subtitle').textContent, 'HOW THEY FIGHT');
  assert.equal(view.node('profile-signature-copy').textContent, fighter.bio);
  assert.equal(view.node('profile-known-for').textContent, fighter.knownFor);
  assert.equal(view.node('profile-status').textContent, fighter.nickname);
  assert.deepEqual(facts(view), {
    Representing: 'Sweden', Height: '180 cm', 'Last fight weight': '77 kg',
    'Fighting background': 'Boxing', Affiliation: 'Example gym', Record: '2–0',
  });
  assert.deepEqual(winRows(view), [
    ['KO / TKO', 'NA', '(0)'], ['Submission', 'NA', '(2)'], ['Opponent forfeit', 'NA', 'NA'],
  ]);
  assert.equal(view.node('profile-win-chart').style.getPropertyValue('--win-chart'), '#292929');
  assertBloodDrop(view);
  assertMeter(view, 'Love', 0);
  assertMeter(view, 'Hate', 6);
  assert.equal(view.node('profile-social').hidden, false);
  assert.equal(view.node('profile-social').href, fighter.instagram);
  assert.equal(view.node('profile-social-label').textContent, '@example');
  assert.equal(view.node('profile-social')['aria-label'], 'Instagram: @example (opens in a new tab)');
  assertPhotoTrigger(view.node('profile-photos').children[0], fighter.photos[0], 0, 1);
});

test('photo gallery filters invalid entries and numbers accessible thumbnails after filtering', () => {
  const first = { src: 'thumb-1.jpg', fullSrc: 'full-1.jpg', alt: 'First photo' };
  const second = { src: 'thumb-2.jpg', fullSrc: '   ', alt: '' };
  const view = render([fixture({
    photos: [null, {}, { src: '' }, { src: '   ' }, { src: 42 }, first, second],
  })], '?fighter=test-fighter');
  const buttons = view.node('profile-photos').children;
  assert.equal(buttons.length, 2);
  assertPhotoTrigger(buttons[0], first, 0, 2);
  assertPhotoTrigger(buttons[1], { src: second.src, alt: 'Test Fighter SC1 photo' }, 1, 2);
});

test('empty or invalid photo collections fall back to the portrait or a blank placeholder', () => {
  for (const photos of [undefined, {}, [], [null, { src: '' }, { src: '   ' }]]) {
    const fighter = fixture({ photos });
    const fallback = render([fighter], '?fighter=test-fighter').node('profile-photos').children;
    assert.equal(fallback.length, 1);
    assertPhotoTrigger(fallback[0], { src: fighter.portrait, alt: 'Test Fighter official portrait' }, 0, 1);
    const empty = render([fixture({ photos, portrait: '' })], '?fighter=test-fighter').node('profile-photos').children;
    assert.equal(empty.length, 1);
    assert.equal(empty[0].tagName, 'DIV');
    assert.equal(empty[0].className, 'profile-media-empty');
    assert.equal(empty[0].textContent, '');
  }
});

test('Instagram link keeps its decorative icon and arrow when its handle changes', () => {
  const anchor = profileHtml.match(/<a\b[^>]*\bid="profile-social"[^>]*>([\s\S]*?)<\/a>/i);
  assert.ok(anchor, 'The profile has an Instagram anchor');
  const icon = anchor[1].match(/<svg\b([^>]*)>/i);
  assert.ok(icon, 'The Instagram icon is inline SVG');
  assert.match(icon[1], /\baria-hidden="true"/);
  assert.match(icon[1], /\bfocusable="false"/);
  assert.match(anchor[1], /<span\b[^>]*\bid="profile-social-label"[^>]*>/);
  assert.match(anchor[1], /<span\b[^>]*\baria-hidden="true"[^>]*>\s*↗\s*<\/span>/);
  assert.doesNotMatch(renderer, /\bsocial\.textContent\s*=/,
    'Updating the handle must not erase the static Instagram icon');
});

test('legacy profiles without the result objects still render NA and keep weightClass fallback', () => {
  const fighter = fixture({ weight: '', weightClass: 'Welterweight', winBy: undefined, fanReaction: undefined });
  const view = render([fighter], '?fighter=test-fighter');
  assert.equal(facts(view)['Last fight weight'], 'Welterweight');
  assertUnknownWins(view);
  assertMeter(view, 'Love', null);
  assertMeter(view, 'Hate', null);
});

test('zero wins remain zero counts without inventing a chart or record percentage', () => {
  const view = render([fixture({
    record: '0–0', winBy: { koTko: 0, submission: 0, opponentForfeit: 0 },
    fanReaction: { love: 0, hate: 0 },
  })], '?fighter=test-fighter');
  assert.deepEqual(winRows(view), [
    ['KO / TKO', 'NA', '(0)'], ['Submission', 'NA', '(0)'], ['Opponent forfeit', 'NA', '(0)'],
  ]);
  assert.equal(view.node('profile-win-chart').style.getPropertyValue('--win-chart'), '#292929');
  assertBloodDrop(view);
  assertMeter(view, 'Love', 0);
  assertMeter(view, 'Hate', 0);
});

test('complete method counts support zero shares, records with draws, and fractional reactions', () => {
  const view = render([fixture({
    record: '2–1–1', winBy: { koTko: 0, submission: 2, opponentForfeit: 0 },
    fanReaction: { love: 8.5, hate: 10 },
  })], '?fighter=test-fighter');
  assert.deepEqual(winRows(view), [
    ['KO / TKO', '0%', '(0)'], ['Submission', '100%', '(2)'], ['Opponent forfeit', '0%', '(0)'],
  ]);
  assert.equal(view.node('profile-win-chart').style.getPropertyValue('--win-chart'), 'conic-gradient(#ffad1f 0% 100%)');
  assertBloodDrop(view);
  assertMeter(view, 'Love', 8.5);
  assertMeter(view, 'Hate', 10);
});

test('invalid counts, records, and ratings render unavailable values without fabricating percentages', () => {
  for (const invalid of [-1, 0.5, '5', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const view = render([fixture({
      record: 'not a record', winBy: { koTko: invalid, submission: 2, opponentForfeit: 0 },
      fanReaction: { love: -1, hate: 11 },
    })], '?fighter=test-fighter');
    assert.deepEqual(winRows(view), [
      ['KO / TKO', 'NA', 'NA'], ['Submission', 'NA', '(2)'], ['Opponent forfeit', 'NA', '(0)'],
    ]);
    assert.equal(view.node('profile-win-chart').style.getPropertyValue('--win-chart'), '#292929');
    assertBloodDrop(view);
    assertMeter(view, 'Love', null);
    assertMeter(view, 'Hate', null);
  }
  for (const invalid of [NaN, Infinity, '8']) {
    const view = render([fixture({ fanReaction: { love: invalid, hate: invalid } })], '?fighter=test-fighter');
    assertMeter(view, 'Love', null);
    assertMeter(view, 'Hate', null);
  }
});

test('deferred data event initializes a profile once the roster arrives', () => {
  const view = render([fixture()], '?fighter=test-fighter', { deferred: true });
  assert.equal(view.node('fighter-profile').hidden, true);
  view.deliverData();
  assert.equal(view.node('fighter-profile').hidden, false);
  assert.equal(view.node('profile-stats').children.length, 6);
});

test('fighter text stays text and unsafe social URLs stay hidden', () => {
  const payload = '<img src=x onerror=alert(1)>';
  for (const instagram of ['javascript:alert(1)', 'https://instagram.com.evil.example/fighter', 'not a URL']) {
    const fighter = fixture({
      name: payload, realName: payload, nickname: payload, country: payload,
      knownFor: payload, bio: payload, fightingBackground: payload, instagram,
      photos: [{ src: 'photo.jpg', alt: payload }],
      videos: [{ title: payload, youtubeId: 'k3VHu0-hpQ0' }],
    });
    const view = render([fighter], '?fighter=test-fighter');
    assert.equal(view.node('profile-signature-subtitle').textContent, 'HOW THEY FIGHT');
    for (const id of ['profile-name', 'profile-real-name-value', 'profile-status',
      'profile-signature-copy', 'profile-known-for']) {
      assert.equal(view.node(id).textContent, payload);
      assert.equal(view.node(id).children.length, 0);
    }
    assert.equal(facts(view).Representing, payload);
    assert.equal(facts(view)['Fighting background'], payload);
    assert.equal(view.node('profile-social').hidden, true);
    assertPhotoTrigger(view.node('profile-photos').children[0], fighter.photos[0], 0, 1);
    const video = view.node('profile-videos').children[0];
    assert.equal(video.children[1].textContent, payload);
    assert.equal(video.children[0].children[0].getAttribute('aria-label'), 'Play ' + payload);
  }
});

test('video play buttons independently load their own player only after activation', () => {
  const videos = [
    { title: 'First fight', youtubeId: 'k3VHu0-hpQ0' },
    { title: 'Second fight', youtubeId: 'abcdefghijk' },
  ];
  const view = render([fixture({ videos })], '?fighter=test-fighter');
  const [first, second] = view.node('profile-videos').children.map(card => card.children[0]);
  const firstButton = first.children[0];
  assert.equal(firstButton.type, 'button');
  assert.equal(second.children[0].tagName, 'BUTTON');
  firstButton.dispatch('click');
  const player = first.children[0];
  assert.equal(player.tagName, 'IFRAME');
  assert.equal(player.title, 'First fight');
  assert.equal(player.allowFullscreen, true);
  assert.equal(player.focusOptions.preventScroll, true);
  assert.equal(second.children[0].tagName, 'BUTTON', 'The other video remains a preview');
  firstButton.dispatch('click');
  assert.equal(first.children[0], player, 'The removed trigger cannot create duplicate players');
  second.children[0].dispatch('click');
  assert.match(second.children[0].src, /\/abcdefghijk\?autoplay=1/);
});

test('video previews ignore invalid IDs, preserve an empty placeholder and tolerate failed thumbnails', () => {
  for (const videos of [null, {}, [], [null, {}, { youtubeId: 'id?x=<script>' }]]) {
    const view = render([fixture({ videos })], '?fighter=test-fighter');
    assert.equal(view.node('profile-videos').children[0].className, 'profile-media-empty');
  }
  const view = render([fixture()], '?fighter=test-fighter');
  const play = view.node('profile-videos').children[0].children[0].children[0];
  play.children[0].dispatch('error');
  assert.equal(play.children[0].hidden, true);
  assert.equal(play.children[1].getAttribute('aria-hidden'), 'true');
  play.dispatch('click');
  assert.equal(view.node('profile-videos').children[0].children[0].children[0].tagName, 'IFRAME');
});

test('fighters overview leaves application CTA to the shared footer', () => {
  const overview = fs.readFileSync(path.join(root, 'athletes.html'), 'utf8');
  assert.doesNotMatch(overview, /<[^>]+class="fighters-apply-row"/);
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /class="shop-footer-cta"/);
  assert.match(app, /class="shop-footer-apply" href="index\.html#apply"/);
});

test('fighters cards follow the heading without the removed roster status bar', () => {
  const overview = fs.readFileSync(path.join(root, 'athletes.html'), 'utf8');
  assert.doesNotMatch(overview, /fighters-roster-status|SC1 roster \/ Season 01|Official fighter profiles/);
  assert.match(overview, /<\/header>\s*<div class="fighters-card-grid"/);
});
