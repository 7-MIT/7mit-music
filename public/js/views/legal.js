import { h } from '../core/dom.js';
const P = (t, ...c) => [h('h2', { class: 'sec' }, t), ...c.map(x => h('p', { class: 'muted', style: { maxWidth: '72ch' } }, x))];
export default ({ el }) => {
  const priv = location.pathname === '/privacy';
  el.append(h('div', { class: 'pagehead' }, h('div', h('h1', priv ? 'Privacy' : 'Terms'), h('p', 'This is a self-hosted application. The operator of this server is responsible for these policies — review and adapt them before public use.'))),
    ...(priv ? [
      ...P('What is stored', 'Account email, display name and a salted password hash; preferences; playlists, likes and saved items; playback state; listening history (can be turned off in Settings → Privacy); recognition history; room membership; audio and covers you upload.'),
      ...P('What leaves this server', 'Nothing, unless you enable an optional integration. Last.fm scrobbling sends the artist and title of songs you finish. AI suggestions send your request and a list of catalogue titles to the configured AI provider, only after you consent. Music recognition sends a short microphone sample to the configured recognition provider, only when you press the button.'),
      ...P('Your controls', 'Export or delete all of your data from Account. Clear history at any time. Microphone access is requested only when you start recognition and is released immediately afterwards.'),
      ...P('YouTube', 'If YouTube is enabled, search terms you type are sent to the YouTube Data API by this server, and playing a YouTube track loads YouTube’s embedded player in your browser after you consent. YouTube/Google then handle that traffic under their own terms and privacy policy.'),
      ...P('Cookies', 'One HTTP-only session cookie keeps you signed in. Preferences are also kept in your browser’s local storage.')
    ] : [
      ...P('Your content', 'Upload only audio and lyrics you own or have permission to use. Uploads are private to your account. Listening rooms only share catalogue tracks that every listener can stream themselves; Auralys does not rebroadcast audio.'),
      ...P('Demo content', 'The built-in demo catalogue is original, procedurally generated audio and original lyrics created for this project. It is labelled “Demo” and is not a real commercial catalogue.'),
      ...P('Third parties', 'Integrations follow each provider’s own terms. This app does not bypass any platform’s restrictions or download protected streams.'),
      ...P('No warranty', 'The software is provided as is. Review the licences of any branding assets before public distribution.')
    ]));
};
