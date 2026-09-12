import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Eye, EyeOff, MessageSquare, Play, Square } from 'lucide-react';
import {
  YOUTUBE_KEY_URL, appendMessages, fetchChatPage, findLiveChat, loadChatSettings,
  looksLikeApiKey, saveChatSettings, videoIdFrom, type ChatMessage,
} from '../lib/liveChat';
import { openExternal } from '../lib/openExternal';

/**
 * Viewer comments from a YouTube broadcast, so a teacher can answer questions
 * without leaving the app.
 *
 * The polling loop lives in a ref rather than state: a stopped loop must stop
 * immediately, and a render in between must not start a second one.
 */
export function LiveChatPanel() {
  const stored = useRef(loadChatSettings());
  const [apiKey, setApiKey] = useState(stored.current.apiKey);
  const [videoInput, setVideoInput] = useState(stored.current.videoId);
  const [showKey, setShowKey] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<'idle' | 'connecting' | 'reading'>('idle');
  const [error, setError] = useState('');

  const running = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    running.current = false;
    window.clearTimeout(timer.current);
  }, []);

  // Follow the newest message, the way a chat window does.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const videoId = videoIdFrom(videoInput);
  const ready = Boolean(videoId) && looksLikeApiKey(apiKey);

  const stop = () => {
    running.current = false;
    window.clearTimeout(timer.current);
    setState('idle');
  };

  const start = async () => {
    setError('');
    saveChatSettings({ apiKey: apiKey.trim(), videoId: videoInput.trim() });
    setState('connecting');
    const found = await findLiveChat(videoId, apiKey.trim());
    if (!found.liveChatId) {
      setError(found.error?.message ?? 'Could not open the chat.');
      setState('idle');
      return;
    }
    running.current = true;
    setState('reading');

    let pageToken: string | undefined;
    const loop = async () => {
      if (!running.current) return;
      const page = await fetchChatPage({ liveChatId: found.liveChatId as string, nextPageToken: pageToken }, apiKey.trim());
      if (!running.current) return;
      if (page.error) {
        setError(page.error.message);
        // A rejected key or a closed chat will never fix itself, so stop rather
        // than spending the daily quota on requests that cannot succeed.
        if (page.error.fatal) { stop(); return; }
      } else {
        setError('');
      }
      pageToken = page.nextPageToken ?? pageToken;
      setMessages(current => appendMessages(current, page.messages));
      timer.current = window.setTimeout(() => void loop(), page.delay);
    };
    void loop();
  };

  return (
    <section className="content-card span-two">
      <div className="card-title">
        <div>
          <MessageSquare />
          <span>
            <b>Viewer comments</b>
            <small>
              {state === 'reading'
                ? `Reading chat · ${messages.length} message${messages.length === 1 ? '' : 's'}`
                : 'YouTube live chat'}
            </small>
          </span>
        </div>
        {state === 'reading' ? (
          <button className="subtle-btn" onClick={stop}><Square size={13} />Stop</button>
        ) : (
          <button
            className="subtle-btn"
            disabled={!ready || state === 'connecting'}
            onClick={() => void start()}
          ><Play size={13} />{state === 'connecting' ? 'Connecting…' : 'Read comments'}</button>
        )}
      </div>

      <div className="destination-fields">
        <label className="inspector-field">
          <span>Live video link or id</span>
          <input
            aria-label="YouTube live video"
            value={videoInput}
            placeholder="https://youtube.com/watch?v=…"
            onChange={event => setVideoInput(event.target.value)}
          />
        </label>
        <label className="inspector-field">
          <span>YouTube Data API key</span>
          <span className="key-field">
            <input
              aria-label="YouTube API key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
            />
            <button
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              onClick={() => setShowKey(current => !current)}
            >{showKey ? <EyeOff size={13} /> : <Eye size={13} />}</button>
          </span>
        </label>
      </div>

      <small className="field-hint">
        Create a key in the Google Cloud console, enable YouTube Data API v3 on it, and
        leave it unrestricted or restrict it to that one API. It is kept on this PC and
        reused next time.
        <button className="link-btn" onClick={() => void openExternal(YOUTUBE_KEY_URL)}>
          <ExternalLink size={12} />Open the console
        </button>
      </small>

      {error && <div className="destination-caveat mild">{error}</div>}

      <div className="chat-list" ref={listRef}>
        {messages.map(message => (
          <p key={message.id} className={message.badge ? `chat-line ${message.badge}` : 'chat-line'}>
            <b>{message.author}</b>
            {message.text}
          </p>
        ))}
        {!messages.length && (
          <p className="panel-hint">
            {state === 'reading'
              ? 'Connected. Messages appear here as viewers send them.'
              : 'Paste the link to your live video, add a key, then read the comments.'}
          </p>
        )}
      </div>

      <p className="panel-hint">
        Comments can be read but not answered from here: posting a reply needs your
        Google account sign-in, which this app deliberately does not ask for. TikTok and
        Instagram publish no way to read a live chat at all, so only YouTube works.
      </p>
    </section>
  );
}
