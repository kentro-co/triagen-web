import { useState, useEffect, useRef } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  LocalAudioTrack,
  RemoteAudioTrack,
  ParticipantKind,
  type Participant,
} from 'livekit-client';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import useDarkMode from '../hooks/useDarkMode';
import { config } from '../utils/config';
import StatusMessage from './ui/StatusMessage';
import VoiceBars from './ui/VoiceBars';
import RemoteAudioTrackComponent from './RemoteAudioTrack';

interface InterviewRoomProps {
  jwtToken: string;
  onFinished: () => void;
}

// LiveKit Agents publishes its speech (and the candidate's STT) on this text
// stream topic, and its lifecycle state as a participant attribute.
const TRANSCRIPTION_TOPIC = 'lk.transcription';
const AGENT_STATE_ATTRIBUTE = 'lk.agent.state';

type AgentState = 'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking';

function agentStateLabel(state: AgentState | null): string {
  switch (state) {
    case 'listening':
    case 'idle':
      return 'Ouvindo você…';
    case 'thinking':
      return 'Pensando…';
    case 'speaking':
      return 'Falando…';
    default:
      return 'Preparando a entrevista…';
  }
}

function InterviewRoom({ jwtToken, onFinished }: Readonly<InterviewRoomProps>) {
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [localAudioTrack, setLocalAudioTrack] = useState<LocalAudioTrack | null>(null);
  const [remoteAudioTracks, setRemoteAudioTracks] = useState<RemoteAudioTrack[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  // The agent's current (or last complete) utterance; kept until it speaks again.
  const [agentCaption, setAgentCaption] = useState('');
  const [candidateCaption, setCandidateCaption] = useState('');

  const { darkMode } = useDarkMode();
  const roomRef = useRef<Room | null>(null);
  const isConnectingRef = useRef(false);
  const captionRef = useRef<HTMLDivElement>(null);

  // Long answers scroll inside the caption box; keep the newest words in view.
  useEffect(() => {
    const el = captionRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agentCaption]);

  // Timer
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs > 0 ? `${hrs.toString().padStart(2, '0')}:` : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const connectToRoom = async () => {
      if (isConnectingRef.current) return;
      isConnectingRef.current = true;
      setError('');

      try {
        const roomInstance = new Room();
        roomRef.current = roomInstance;

        roomInstance.on(RoomEvent.Connected, () => setIsConnected(true));
        roomInstance.on(RoomEvent.Disconnected, () => {
          setIsConnected(false);
          setLocalAudioTrack(null);
          roomRef.current = null;
          onFinished();
        });
        roomInstance.on(RoomEvent.TrackSubscribed, (track: Track) => {
          if (track.kind === Track.Kind.Audio) {
            setRemoteAudioTracks(prev => [...prev, track as RemoteAudioTrack]);
          }
        });
        roomInstance.on(RoomEvent.TrackUnsubscribed, (track: Track) => {
          if (track.kind === Track.Kind.Audio) {
            setRemoteAudioTracks(prev => prev.filter(t => t.sid !== track.sid));
          }
        });

        const readAgentState = (participant: Participant) => {
          if (participant.kind !== ParticipantKind.AGENT) return;
          const state = participant.attributes[AGENT_STATE_ATTRIBUTE];
          if (state) setAgentState(state as AgentState);
        };
        roomInstance.on(RoomEvent.ParticipantConnected, readAgentState);
        roomInstance.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => readAgentState(participant));

        // Registered before connect so the agent's opening line isn't missed.
        roomInstance.registerTextStreamHandler(TRANSCRIPTION_TOPIC, async (reader, participantInfo) => {
          const fromCandidate = participantInfo.identity === roomInstance.localParticipant.identity;
          try {
            if (fromCandidate) {
              // STT sends interim then final versions of each segment; show finals only.
              const text = await reader.readAll();
              if (reader.info.attributes?.['lk.transcription_final'] === 'true' && text.trim()) {
                setCandidateCaption(text.trim());
              }
              return;
            }
            // The agent's speech arrives as one stream per utterance, written word
            // by word in sync with the audio.
            let text = '';
            setAgentCaption('');
            for await (const chunk of reader) {
              text += chunk;
              setAgentCaption(text);
            }
          } catch {
            // A stream can be cut off mid-read (interruption, reconnect); keep what arrived.
          }
        });

        await roomInstance.connect(config.livekitUrl, jwtToken, { autoSubscribe: true });
        roomInstance.remoteParticipants.forEach(readAgentState);
        await roomInstance.localParticipant.setMicrophoneEnabled(true);

        const audioTrackPubs = Array.from(roomInstance.localParticipant.audioTrackPublications.values());
        if (audioTrackPubs.length > 0 && audioTrackPubs[0].track) {
          setLocalAudioTrack(audioTrackPubs[0].track as LocalAudioTrack);
        }

        setRoom(roomInstance);
      } catch {
        setError('Falha ao conectar na sala de entrevista. Recarregue a página e tente novamente.');
      } finally {
        isConnectingRef.current = false;
      }
    };

    connectToRoom();
    return () => {
      roomRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jwtToken]);

  const toggleMute = () => {
    if (room?.localParticipant) {
      const newMutedState = !isMuted;
      room.localParticipant.setMicrophoneEnabled(!newMutedState);
      setIsMuted(newMutedState);
    }
  };

  const disconnect = () => {
    room?.disconnect();
  };

  if (!isConnected && !error) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center ${darkMode ? 'bg-gray-900 text-white' : 'bg-triagen-neutral text-triagen-primary'}`}>
        <div className={`w-12 h-12 rounded-full border-2 border-t-transparent animate-spin mb-4 ${darkMode ? 'border-gray-500' : 'border-triagen-primary'}`} />
        <p className={`font-sans text-sm uppercase tracking-widest ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>Conectando à entrevista...</p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col font-sans relative overflow-hidden ${darkMode ? 'bg-gray-900 text-gray-100' : 'bg-triagen-neutral text-triagen-primary'}`}>

      {/* Remote Tracks Container (Hidden) */}
      <div className="hidden">
        {remoteAudioTracks.map((track, idx) => (
          <RemoteAudioTrackComponent key={track.sid || idx} track={track} />
        ))}
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <StatusMessage type="error" message={error} darkMode={darkMode} />
        </div>
      ) : (
        <>
          {/* Header */}
          <header className="absolute top-0 w-full z-10 p-6 md:px-12 flex justify-between items-center">
            <h1 className="text-xl font-heading font-semibold tracking-tight">TriaGen</h1>

            <div className={`flex items-center gap-2 text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-triagen-secondary'}`}>
              <div className="w-2 h-2 rounded-full bg-triagen-secondary-green animate-pulse" />
              {formatTime(elapsedTime)}
            </div>
          </header>

          {/* Main Stage */}
          <main className="flex-1 flex flex-col items-center justify-center p-6 mt-16 max-w-4xl mx-auto w-full text-center">

            {/* Agent state — what the interviewer is doing right now */}
            <p
              className={`flex items-center justify-center gap-2 text-xs uppercase tracking-[0.2em] font-semibold mb-6 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}
              aria-live="polite"
            >
              <span className={`w-2 h-2 rounded-full ${agentState === 'speaking' ? 'bg-triagen-secondary-green animate-pulse' : darkMode ? 'bg-gray-500' : 'bg-triagen-secondary'}`} />
              {agentStateLabel(agentState)}
            </p>

            {/* Caption of the interviewer's speech */}
            <div
              ref={captionRef}
              className="w-full max-w-2xl max-h-[45vh] overflow-y-auto mb-6"
            >
              <p className={`text-2xl md:text-3xl font-heading font-normal leading-snug ${agentCaption ? (darkMode ? 'text-white' : 'text-triagen-primary') : (darkMode ? 'text-gray-500' : 'text-triagen-secondary')}`}>
                {agentCaption || 'A entrevistadora vai começar em instantes.'}
              </p>
            </div>

            {candidateCaption && (
              <p className={`w-full max-w-md text-sm leading-relaxed line-clamp-2 mb-6 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                <span className="font-semibold">Você: </span>{candidateCaption}
              </p>
            )}

            {/* Live voice meter — reflects the candidate's own microphone */}
            <VoiceBars
              track={localAudioTrack}
              muted={isMuted}
              darkMode={darkMode}
            />
            {isMuted && (
              <p className="flex items-center text-xs tracking-wider uppercase text-red-500 mt-2">
                <MicOff className="w-3 h-3 mr-2" /> Microfone silenciado
              </p>
            )}
            <div className="mb-20 md:mb-32" />
          </main>

          {/* Bottom Dock Navigation */}
          <div className="absolute bottom-12 w-full flex justify-center z-10 px-4">
            <div className={`flex items-center gap-2 md:gap-4 p-2 rounded-2xl shadow-sm border ${darkMode ? 'bg-gray-800/90 border-gray-700 backdrop-blur-md' : 'bg-white/90 border-neutral-200 backdrop-blur-md'}`}>

              {/* Mute Button */}
              <button
                onClick={toggleMute}
                aria-pressed={isMuted}
                className={`flex flex-col items-center justify-center w-24 h-20 rounded-xl transition-colors ${isMuted ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' : darkMode ? 'hover:bg-gray-700' : 'bg-neutral-100/50 hover:bg-neutral-100'}`}
              >
                {isMuted ? <MicOff strokeWidth={1.5} className="w-6 h-6 mb-2" /> : <Mic strokeWidth={1.5} className="w-6 h-6 mb-2" />}
                <span className="text-[0.65rem] uppercase tracking-widest font-semibold">{isMuted ? 'Reativar' : 'Silenciar'}</span>
              </button>

              <div className={`w-px h-12 mx-2 ${darkMode ? 'bg-gray-700' : 'bg-neutral-200'}`} />

              {/* End Session Button */}
              <button
                onClick={disconnect}
                className={`flex flex-col items-center justify-center w-24 h-20 rounded-xl transition-colors text-red-500 ${darkMode ? 'hover:bg-red-500/10' : 'bg-red-50 hover:bg-red-100'}`}
              >
                <PhoneOff strokeWidth={1.5} className="w-6 h-6 mb-2" />
                <span className="text-[0.65rem] uppercase tracking-widest font-semibold text-red-600">Encerrar</span>
              </button>

            </div>
          </div>

          {/* Bottom Tags */}
          <div className={`absolute bottom-6 w-full px-6 md:px-12 flex justify-center items-center text-[0.65rem] tracking-widest uppercase font-semibold ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
            <span>Sessão segura • TriaGen</span>
          </div>
        </>
      )}
    </div>
  );
}

export default InterviewRoom;
