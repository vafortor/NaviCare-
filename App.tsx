
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Message, TriageResult, TriageLevel, Provider, AssessmentData } from './types';
import { processTriage, searchProviders, getGreeting, generateSpeech } from './services/geminiService';
import { RED_FLAGS, APP_THEME } from './constants';

const LANGUAGES = [
  { code: 'English', label: 'English', flag: '🇺🇸', voice: 'Kore' },
  { code: 'Spanish', label: 'Español', flag: '🇪🇸', voice: 'Kore' },
  { code: 'French', label: 'Français', flag: '🇫🇷', voice: 'Kore' },
  { code: 'German', label: 'Deutsch', flag: '🇩🇪', voice: 'Kore' },
  { code: 'Chinese', label: '中文', flag: '🇨🇳', voice: 'Kore' },
  { code: 'Japanese', label: '日本語', flag: '🇯🇵', voice: 'Kore' },
  { code: 'Arabic', label: 'العربية', flag: '🇸🇦', voice: 'Kore' },
  { code: 'Portuguese', label: 'Português', flag: '🇵🇹', voice: 'Kore' },
  { code: 'Italian', label: 'Italiano', flag: '🇮🇹', voice: 'Kore' },
  { code: 'Russian', label: 'Русский', flag: '🇷🇺', voice: 'Kore' },
  { code: 'Hindi', label: 'हिन्दी', flag: '🇮🇳', voice: 'Kore' },
  { code: 'Korean', label: '한국어', flag: '🇰🇷', voice: 'Kore' },
  { code: 'Dutch', label: 'Nederlands', flag: '🇳🇱', voice: 'Kore' },
  { code: 'Turkish', label: 'Türkçe', flag: '🇹🇷', voice: 'Kore' },
  { code: 'Vietnamese', label: 'Tiếng Việt', flag: '🇻🇳', voice: 'Kore' }
];

const STRIPE_URL = "https://buy.stripe.com/9B6eV63n9cFu9aP83D3AY02";

// Helper functions for audio processing
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [language, setLanguage] = useState('English');
  const [langSearch, setLangSearch] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [savedProviders, setSavedProviders] = useState<Provider[]>([]);
  const [zipCode, setZipCode] = useState('');
  const [insurance, setInsurance] = useState('');
  const [showConsent, setShowConsent] = useState(true);
  const [isEmergencyEscalated, setIsEmergencyEscalated] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('navicare_saved_providers');
    if (saved) {
      try {
        setSavedProviders(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load saved providers", e);
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setShowLangMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    // Initialize Speech Recognition if available
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filteredLanguages = useMemo(() => {
    return LANGUAGES.filter(l => 
      l.label.toLowerCase().includes(langSearch.toLowerCase()) || 
      l.code.toLowerCase().includes(langSearch.toLowerCase())
    );
  }, [langSearch]);

  const saveToLocalStorage = (data: Provider[]) => {
    localStorage.setItem('navicare_saved_providers', JSON.stringify(data));
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleStart = async () => {
    setShowConsent(false);
    setLoading(true);
    try {
      const greeting = await getGreeting(language);
      const initialMessage: Message = {
        role: 'model',
        text: greeting,
        timestamp: Date.now()
      };
      setMessages([initialMessage]);
    } catch (error) {
      setMessages([{
        role: 'model',
        text: "Hello, I am NaviCare AI. How can I help you today?",
        timestamp: Date.now()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleNewAssessment = () => {
    // Reset all session specific states
    setMessages([]);
    setInput('');
    setLoading(false);
    setTriageResult(null);
    setProviders([]);
    setZipCode('');
    setInsurance('');
    setIsEmergencyEscalated(false);
    setShowSaved(false);
    setShowConsent(true);
    setIsSpeaking(false);
    setIsListening(false);
    
    // Stop any ongoing speech or recognition
    if (recognitionRef.current) recognitionRef.current.stop();
    if (audioContextRef.current) {
      audioContextRef.current.close().then(() => {
        audioContextRef.current = null;
      });
    }
  };

  const playVoice = async (text: string) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    try {
      const voiceData = await generateSpeech(text);
      if (voiceData) {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = audioContextRef.current;
        const outputNode = ctx.createGain();
        outputNode.connect(ctx.destination);
        
        const audioBuffer = await decodeAudioData(
          decode(voiceData),
          ctx,
          24000,
          1
        );
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputNode);
        source.onended = () => setIsSpeaking(false);
        source.start();
      } else {
        setIsSpeaking(false);
      }
    } catch (e) {
      console.error("Speech synthesis failed", e);
      setIsSpeaking(false);
    }
  };

  const handleListen = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.lang = LANGUAGES.find(l => l.code === language)?.code || 'en-US';
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: 'user',
      text: input,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const history = [...messages, userMessage].map(m => ({
        role: m.role,
        text: m.text
      }));

      const result = await processTriage(history, language);

      if (result.isTriageComplete && result.triageResult) {
        setTriageResult(result.triageResult);
        if (result.triageResult.level === TriageLevel.EMERGENCY) {
          setIsEmergencyEscalated(true);
        }
        
        const assistantMessage: Message = {
          role: 'model',
          text: result.triageResult.recommendation,
          timestamp: Date.now()
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        const assistantMessage: Message = {
          role: 'model',
          text: result.nextQuestion || "Can you tell me more?",
          timestamp: Date.now()
        };
        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, {
        role: 'model',
        text: "I'm having a technical issue. Please try again or seek medical advice if your symptoms are concerning.",
        timestamp: Date.now()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleProviderSearch = async () => {
    if (!zipCode || !triageResult?.specialtyNeeded) return;
    setLoading(true);
    try {
      const found = await searchProviders(triageResult.specialtyNeeded, zipCode, insurance, language);
      setProviders(found);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSaveProvider = (provider: Provider) => {
    const isSaved = savedProviders.find(p => p.name === provider.name && p.phone === provider.phone);
    let newSaved;
    if (isSaved) {
      newSaved = savedProviders.filter(p => p.name !== provider.name || p.phone !== provider.phone);
    } else {
      newSaved = [...savedProviders, provider];
    }
    setSavedProviders(newSaved);
    saveToLocalStorage(newSaved);
  };

  const isProviderSaved = (provider: Provider) => {
    return savedProviders.some(p => p.name === provider.name && p.phone === provider.phone);
  };

  if (showConsent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-100">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-600 p-4 rounded-full">
              <i className="fa-solid fa-house-medical text-3xl text-white"></i>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2 text-slate-800">Welcome to NaviCare AI</h1>
          
          <div className="mb-6">
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-2">Select Preferred Language</label>
            <div className="relative mb-3">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input 
                type="text"
                placeholder="Search language..."
                value={langSearch}
                onChange={(e) => setLangSearch(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition"
              />
            </div>
            <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-lg p-1 bg-slate-50 scrollbar-thin scrollbar-thumb-slate-200">
              <div className="grid grid-cols-1 gap-1">
                {filteredLanguages.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => setLanguage(lang.code)}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md transition text-sm ${
                      language === lang.code 
                      ? 'bg-blue-600 text-white font-bold' 
                      : 'hover:bg-white text-slate-600 border border-transparent hover:border-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-base">{lang.flag}</span>
                      <span>{lang.label}</span>
                    </span>
                    {language === lang.code && <i className="fa-solid fa-check text-[10px]"></i>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-slate-600 mb-6 text-center text-sm leading-relaxed border-t pt-4">
            NaviCare helps you assess symptoms and navigate to the right medical setting. 
            <strong> Not for emergency use.</strong>
          </p>
          
          <button 
            onClick={handleStart}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition shadow-lg active:scale-95"
          >
            I Understand & Start
          </button>
        </div>
      </div>
    );
  }

  const renderProviderCard = (p: Provider, idx: number) => (
    <div key={idx} className="group border border-slate-100 rounded-xl p-4 bg-white hover:border-blue-200 hover:shadow-md transition">
      <div className="flex justify-between items-start mb-2">
        <h5 className="font-bold text-slate-800 text-sm">{p.name}</h5>
        <button 
          onClick={() => toggleSaveProvider(p)}
          className={`p-1 rounded-full transition ${isProviderSaved(p) ? 'text-amber-500 bg-amber-50' : 'text-slate-300 hover:text-amber-500 bg-slate-50'}`}
        >
          <i className={`fa-${isProviderSaved(p) ? 'solid' : 'regular'} fa-star`}></i>
        </button>
      </div>
      
      <p className="text-[11px] text-slate-500 mb-2 flex items-start gap-1">
        <i className="fa-solid fa-location-dot mt-0.5 text-slate-400"></i>
        {p.address}
      </p>
      
      {p.hours && (
        <p className="text-[10px] text-slate-400 mb-2 flex items-center gap-1">
          <i className="fa-regular fa-clock"></i>
          {p.hours}
        </p>
      )}

      {p.acceptedInsurance && p.acceptedInsurance.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
           {p.acceptedInsurance.map((ins, i) => (
             <span key={i} className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
               {ins}
             </span>
           ))}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2 border-t border-slate-50">
        <div className="flex items-center justify-between">
           <a href={`tel:${p.phone}`} className="text-[11px] text-blue-600 font-bold flex items-center gap-1 hover:underline">
             <i className="fa-solid fa-phone"></i> {p.phone}
           </a>
           {p.verified && (
             <span className="text-[9px] flex items-center gap-0.5 text-emerald-600 font-bold">
               <i className="fa-solid fa-circle-check"></i> VERIFIED
             </span>
           )}
        </div>
        
        {p.bookingUrl && (
          <a 
            href={p.bookingUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="w-full bg-blue-50 text-blue-700 text-center py-2 rounded-lg text-xs font-bold hover:bg-blue-100 transition mt-1"
          >
            Book Appointment
          </a>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto bg-white shadow-2xl relative">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 p-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <i className="fa-solid fa-route text-white"></i>
          </div>
          <div>
            <h1 className="font-bold text-slate-800 leading-tight">NaviCare Navigator</h1>
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              {language} Assessment
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
            <a 
              href={STRIPE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all hover:scale-105 active:scale-95 mr-2"
            >
              <i className="fa-solid fa-crown"></i>
              <span>Go Premium</span>
            </a>

            <div className="relative" ref={langMenuRef}>
              <button 
                onClick={() => {
                  setShowLangMenu(!showLangMenu);
                  setLangSearch('');
                }}
                className={`p-2 rounded-lg transition flex items-center gap-1 ${showLangMenu ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                title="Change Language"
              >
                <i className="fa-solid fa-globe"></i>
                <span className="text-[10px] font-bold">{LANGUAGES.find(l => l.code === language)?.flag}</span>
              </button>
              {showLangMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-2xl z-20 py-3 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="px-3 pb-2 border-b border-slate-50 mb-2">
                    <div className="relative">
                      <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]"></i>
                      <input 
                        type="text"
                        autoFocus
                        placeholder="Search..."
                        value={langSearch}
                        onChange={(e) => setLangSearch(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-100 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-400 outline-none"
                      />
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto px-1 scrollbar-thin scrollbar-thumb-slate-100">
                    {filteredLanguages.map(lang => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          setLanguage(lang.code);
                          setShowLangMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between rounded-lg transition ${language === lang.code ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        <span className="flex items-center gap-2">
                          <span>{lang.flag}</span>
                          <span>{lang.label}</span>
                        </span>
                        {language === lang.code && <i className="fa-solid fa-check scale-75"></i>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button 
              onClick={() => setShowSaved(!showSaved)}
              className={`p-2 rounded-lg transition ${showSaved ? 'bg-amber-100 text-amber-600' : 'text-slate-400 hover:text-slate-600'}`}
              title="Saved Providers"
            >
              <i className="fa-solid fa-star"></i>
              {savedProviders.length > 0 && <span className="ml-1 text-xs font-bold">{savedProviders.length}</span>}
            </button>
            <button 
              onClick={handleNewAssessment}
              className="text-slate-400 hover:text-slate-600 p-2 transition"
              title="New Assessment"
            >
              <i className="fa-solid fa-rotate-right"></i>
            </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 space-y-6 flex flex-col md:flex-row gap-6">
        {/* Left Column: Chat Interface */}
        <div className="flex-1 flex flex-col h-full bg-slate-50 rounded-xl border border-slate-200 overflow-hidden min-h-[400px]">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 rounded-2xl relative ${
                  m.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none shadow-md' 
                  : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none shadow-sm'
                }`}>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.text}</p>
                  
                  {m.role === 'model' && (
                    <button 
                      onClick={() => playVoice(m.text)}
                      disabled={isSpeaking}
                      className={`absolute -right-8 bottom-2 text-slate-400 hover:text-blue-500 transition-colors ${isSpeaking ? 'animate-pulse text-blue-500' : ''}`}
                      title="Read aloud"
                    >
                      <i className={`fa-solid ${isSpeaking ? 'fa-volume-high' : 'fa-volume-low'}`}></i>
                    </button>
                  )}

                  <span className={`text-[10px] mt-2 block ${m.role === 'user' ? 'text-blue-100' : 'text-slate-400'}`}>
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 p-4 rounded-2xl rounded-tl-none shadow-sm flex gap-1">
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-.3s]"></div>
                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-.5s]"></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          {!triageResult && (
            <div className="p-4 bg-white border-t border-slate-200">
               <div className="flex gap-2 items-center">
                  <button 
                    onClick={handleListen}
                    className={`p-2 rounded-full transition-all ${isListening ? 'bg-red-100 text-red-600 animate-pulse scale-110 shadow-lg' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    title={isListening ? "Stop listening" : "Voice input"}
                  >
                    <i className={`fa-solid ${isListening ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
                  </button>
                  
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    placeholder={isListening ? "Listening..." : "Type a message..."}
                    className="flex-1 border border-slate-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                  />
                  
                  <button 
                    onClick={handleSend}
                    disabled={loading || !input.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition disabled:opacity-50"
                  >
                    <i className="fa-solid fa-paper-plane"></i>
                  </button>
               </div>
            </div>
          )}
        </div>

        {/* Right Column: Results & Providers */}
        <aside className={`w-full md:w-80 lg:w-96 flex flex-col gap-4 overflow-y-auto`}>
           <div className="bg-gradient-to-r from-amber-500 to-amber-600 rounded-xl p-4 text-white shadow-lg mb-2 group">
              <div className="flex items-center gap-2 mb-2">
                <i className="fa-solid fa-crown text-amber-200 animate-pulse"></i>
                <h3 className="font-bold text-sm">NaviCare Premium</h3>
              </div>
              <p className="text-[10px] opacity-90 mb-3 leading-relaxed">
                Unlock advanced specialist matching, direct clinician chat, and unlimited assessment history.
              </p>
              <a 
                href={STRIPE_URL} 
                target="_blank" 
                rel="noopener noreferrer"
                className="block w-full bg-white text-amber-600 text-center py-2 rounded-lg text-xs font-bold hover:bg-amber-50 transition-colors shadow-sm"
              >
                Upgrade for $25/mo
              </a>
           </div>

           {/* Saved Providers Overlay View */}
           {showSaved && (
             <div className="bg-amber-50 rounded-xl border border-amber-200 shadow-sm p-4 mb-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-amber-800 flex items-center gap-2">
                    <i className="fa-solid fa-star"></i>
                    Saved Providers
                  </h3>
                  <button onClick={() => setShowSaved(false)} className="text-amber-800 hover:text-amber-900">
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </div>
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                  {savedProviders.length === 0 ? (
                    <p className="text-center text-amber-600 text-xs py-12 italic">No providers saved yet.</p>
                  ) : (
                    savedProviders.map((p, idx) => renderProviderCard(p, idx))
                  )}
                </div>
             </div>
           )}

           {/* Triage Status Card */}
           {triageResult && !showSaved && (
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className={`p-4 flex items-center gap-3 text-white ${
                  triageResult.level === TriageLevel.EMERGENCY ? 'bg-red-600' :
                  triageResult.level === TriageLevel.URGENT ? 'bg-amber-500' :
                  triageResult.level === TriageLevel.ROUTINE ? 'bg-blue-600' : 'bg-emerald-500'
                }`}>
                  <i className={`fa-solid ${
                    triageResult.level === TriageLevel.EMERGENCY ? 'fa-triangle-exclamation' :
                    triageResult.level === TriageLevel.URGENT ? 'fa-clock' :
                    triageResult.level === TriageLevel.ROUTINE ? 'fa-calendar-check' : 'fa-house'
                  }`}></i>
                  <h2 className="font-bold uppercase tracking-wider text-sm">Triage: {triageResult.level}</h2>
                </div>
                <div className="p-4">
                  <div className="mb-4">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Recommended Specialty</label>
                    <p className="font-semibold text-slate-800">{triageResult.specialtyNeeded || 'General Practice'}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                     <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Referral Summary</label>
                     <p className="text-xs text-slate-700 italic leading-relaxed">"{triageResult.summary}"</p>
                     <button 
                       onClick={() => navigator.clipboard.writeText(triageResult.summary)}
                       className="mt-2 text-[10px] text-blue-600 hover:underline flex items-center gap-1"
                     >
                       <i className="fa-regular fa-copy"></i> Copy to clipboard
                     </button>
                  </div>
                </div>
             </div>
           )}

           {/* Provider Search Card */}
           {triageResult && triageResult.level !== TriageLevel.EMERGENCY && triageResult.level !== TriageLevel.SELF_CARE && !showSaved && (
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                  <i className="fa-solid fa-magnifying-glass-location text-blue-600"></i>
                  Find a Provider
                </h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input 
                      type="text" 
                      placeholder="ZIP Code" 
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                    <input 
                      type="text" 
                      placeholder="Insurance" 
                      value={insurance}
                      onChange={(e) => setInsurance(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <button 
                    onClick={handleProviderSearch}
                    disabled={loading || !zipCode}
                    className="w-full bg-slate-800 hover:bg-slate-900 text-white text-sm py-2 rounded-lg transition disabled:opacity-50"
                  >
                    Search {triageResult.specialtyNeeded}
                  </button>
                </div>

                {providers.length > 0 && (
                  <div className="mt-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Top Recommendations</h4>
                    </div>
                    {providers.map((p, idx) => renderProviderCard(p, idx))}
                  </div>
                )}
             </div>
           )}

           {/* Emergency Notice */}
           {isEmergencyEscalated && (
             <div className="bg-red-50 border-2 border-red-600 rounded-xl p-5 text-red-900 animate-pulse shadow-lg">
                <div className="flex items-center gap-3 mb-3">
                  <i className="fa-solid fa-circle-exclamation text-2xl text-red-600"></i>
                  <h3 className="font-black uppercase">IMMEDIATE ACTION</h3>
                </div>
                <p className="text-sm font-bold mb-4">You indicated symptoms that require immediate medical intervention.</p>
                <div className="space-y-3">
                  <a href="tel:911" className="block w-full text-center bg-red-600 text-white py-3 rounded-lg font-black text-lg">911</a>
                </div>
             </div>
           )}
           
           {!triageResult && !showSaved && (
             <div className="bg-slate-50 rounded-xl border border-slate-200 border-dashed p-12 flex flex-col items-center justify-center text-slate-400 text-center">
                <i className="fa-solid fa-clipboard-list text-3xl mb-4 opacity-20"></i>
                <p className="text-xs italic leading-relaxed">Triage results and local provider matches will be displayed here once your assessment is complete.</p>
             </div>
           )}
        </aside>
      </main>

      {/* Persistent Safety Banner */}
      <footer className="bg-slate-900 text-slate-400 py-2 px-4 text-[10px] flex justify-between items-center shrink-0">
         <div className="flex gap-4">
           <span>&copy; NaviCare AI 2024</span>
           <span>Standard Compliance Ready</span>
         </div>
         <div className="flex items-center gap-1">
           <i className="fa-solid fa-shield-halved text-emerald-500"></i>
           <span>Secure Health Data</span>
         </div>
      </footer>
    </div>
  );
};

export default App;
