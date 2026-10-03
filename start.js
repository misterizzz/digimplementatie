/* Startscherm: opent met het wachtwoord de versleutelde game, brief en cv.
   Zonder wachtwoord is de inhoud onleesbaar. Er wordt niets opgeslagen. */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const slot = $('.slot');
  const veld = $('#wachtwoord');
  const toon = $('.toon');
  const knop = slot.querySelector('.knop');
  const melding = $('.melding');
  const keuzes = $('.keuzes');
  const titel = $('#titel');
  const spelLaag = $('[data-laag="spel"]');
  const BESTAND = document.documentElement.dataset.inhoud || 'inhoud.bin';

  let inhoud = null;
  let laatsteKaart = null;

  // Hoofdletters, spaties en streepjes maken niet uit.
  const normaliseer = (w) => w.normalize('NFKC').toLowerCase().replace(/[\s\-_]+/g, '');

  // PBKDF2 maakt van het wachtwoord twee sleutels: een om te controleren (HMAC), een om te ontsleutelen (AES).
  async function ontsleutel(wachtwoord) {
    if (!window.crypto || !crypto.subtle) throw new Error('crypto');
    const antwoord = await fetch(BESTAND);
    if (!antwoord.ok) throw new Error('laden');
    const data = new Uint8Array(await antwoord.arrayBuffer());
    if (new TextDecoder().decode(data.slice(0, 4)) !== 'TTT1') throw new Error('laden');
    const rondes = new DataView(data.buffer).getUint32(4);
    const zout = data.slice(8, 24);
    const iv = data.slice(24, 40);
    const zegel = data.slice(40, 72);
    const geheim = data.slice(72);

    const basis = await crypto.subtle.importKey('raw', new TextEncoder().encode(normaliseer(wachtwoord)), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: zout, iterations: rondes }, basis, 512));

    const controle = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const getekend = new Uint8Array(iv.length + geheim.length);
    getekend.set(iv);
    getekend.set(geheim, iv.length);
    if (!(await crypto.subtle.verify('HMAC', controle, zegel, getekend))) throw new Error('wachtwoord');

    const sleutel = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-CBC' }, false, ['decrypt']);
    const tekst = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, sleutel, geheim);
    return JSON.parse(new TextDecoder().decode(tekst));
  }

  function meld(tekst, soort) {
    melding.textContent = tekst;
    melding.className = soort ? `melding ${soort}` : 'melding';
  }

  function pdfAdres(base64) {
    const bytes = Uint8Array.from(atob(base64), (teken) => teken.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  }

  function open() {
    veld.value = '';
    document.querySelectorAll('[data-dicht]').forEach((el) => { el.hidden = true; });
    $('[data-welkom]').hidden = false;
    keuzes.hidden = false;
    $('[data-laag="brief"] .download').href = pdfAdres(inhoud.briefPdf);
    $('[data-laag="cv"] .download').href = pdfAdres(inhoud.cvPdf);
    titel.focus();
  }

  slot.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!veld.value.trim()) {
      meld('Vul eerst het wachtwoord in.', 'fout');
      veld.focus();
      return;
    }
    knop.disabled = true;
    meld('Bezig met openen…');
    try {
      inhoud = await ontsleutel(veld.value);
      meld('');
      open();
    } catch (fout) {
      const uitleg = {
        wachtwoord: 'Dit wachtwoord klopt niet. Hoofdletters en spaties maken niet uit.',
        crypto: 'Deze browser kan de pagina niet openen. Probeer een recente versie van Safari, Chrome, Edge of Firefox.',
      };
      meld(uitleg[fout.message] || 'Openen lukte niet. Controleer je verbinding en probeer het opnieuw.', 'fout');
      veld.select();
    } finally {
      knop.disabled = false;
    }
  });

  toon.addEventListener('click', () => {
    const zichtbaar = veld.type === 'password';
    veld.type = zichtbaar ? 'text' : 'password';
    toon.textContent = zichtbaar ? 'Verberg' : 'Toon';
    toon.setAttribute('aria-pressed', String(zichtbaar));
    veld.focus();
  });

  /* Game, brief en cv */

  function openSpel() {
    const frame = document.createElement('iframe');
    frame.title = 'Tussen twee talen, het spel';
    frame.setAttribute('allow', 'fullscreen; autoplay');
    frame.srcdoc = inhoud.spel;
    frame.addEventListener('load', () => frame.focus());
    spelLaag.replaceChildren(frame);
    spelLaag.hidden = false;
    document.body.classList.add('laag-open');
  }

  function openDocument(soort) {
    const laag = $(`[data-laag="${soort}"]`);
    const plek = laag.querySelector('[data-inhoud]');
    if (!plek.firstElementChild) plek.innerHTML = inhoud[soort];
    laag.hidden = false;
    laag.scrollTop = 0;
    document.body.classList.add('laag-open');
    laag.querySelector('[data-sluit]').focus();
  }

  function sluitLagen() {
    document.querySelectorAll('.laag').forEach((laag) => { laag.hidden = true; });
    spelLaag.replaceChildren();
    document.body.classList.remove('laag-open');
    if (laatsteKaart) laatsteKaart.focus();
  }

  keuzes.addEventListener('click', (e) => {
    const kaart = e.target.closest('[data-kies]');
    if (!kaart || !inhoud) return;
    e.preventDefault();
    laatsteKaart = kaart;
    if (kaart.dataset.kies === 'spel') openSpel();
    else openDocument(kaart.dataset.kies);
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-sluit]')) sluitLagen();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.querySelector('.laag-document:not([hidden])')) sluitLagen();
  });

  // 'Terug naar start' in de game stuurt een bericht naar deze pagina.
  window.addEventListener('message', (e) => {
    const frame = spelLaag.querySelector('iframe');
    if (frame && e.source === frame.contentWindow && e.data && e.data.tussenTweeTalen === 'start') sluitLagen();
  });
})();
