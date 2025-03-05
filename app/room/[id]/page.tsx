"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import { ArrowLeft, Paperclip, Share2, Moon, Sun } from 'lucide-react';
import QRCode from 'react-qr-code';

// Generate a random username for the session
const generateRandomName = () => {
  const adjectives = ['Quick', 'Silent', 'Clever', 'Bold', 'Swift'];
  const nouns = ['Fox', 'Owl', 'Wolf', 'Eagle', 'Bear'];
  const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${randomAdj}${randomNoun}${Math.floor(Math.random() * 100)}`;
};

export default function Room() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params?.id || null;
  const rawKey = searchParams.get('key');
  const key = rawKey ? decodeURIComponent(rawKey) : null;

  const [messages, setMessages] = useState<{ text: string; sender: string }[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');
  const [showQRCode, setShowQRCode] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const roomUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/room/${id}?key=${rawKey}`
    : '';

  useEffect(() => {
    if (!username) {
      setUsername(generateRandomName());
    }
  }, [username]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('touchstart', (e) => {
        e.stopPropagation();
      }, { passive: true });
      
      container.addEventListener('touchmove', (e) => {
        e.stopPropagation();
      }, { passive: true });
    }

    if (!id || !key) {
      setError('Room ID or key missing');
      return;
    }

    try {
      base64Decode(key);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError('Invalid encryption key format: ' + errorMessage);
      return;
    }

    const checkExpiration = async () => {
      const { data } = await supabase
        .from('rooms')
        .select('expires_at')
        .eq('id', id)
        .single();
      if (data && new Date(data.expires_at) < new Date()) {
        router.push('/expired');
      }
    };
    checkExpiration();

    const fetchAndDecrypt = async () => {
      const { data, error } = await supabase.from('rooms').select('messages').eq('id', id).single();
      if (error) {
        setError('Failed to fetch messages: ' + error.message);
        return;
      }
      if (data?.messages) {
        try {
          const decrypted = await Promise.all(
            data.messages.map(async (encrypted: string) => {
              const decryptedMsg = await decrypt(encrypted, key);
              return decryptedMsg;
            })
          );
          const parsedMessages = decrypted
            .filter((msg): msg is string => msg !== null)
            .map((msg) => {
              try {
                return JSON.parse(msg);
              } catch {
                return { text: msg, sender: 'Unknown' };
              }
            });
          setMessages(parsedMessages);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          setError('Failed to decrypt messages: ' + errorMessage);
        }
      }
    };
    fetchAndDecrypt();

    let retryCount = 0;
    const maxRetries = 5;
    const subscribeWithRetry = () => {
      const channel = supabase
        .channel(`room:${id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` },
          async (payload) => {
            try {
              const decrypted = await Promise.all(
                payload.new.messages.map(async (encrypted: string) => {
                  const decryptedMsg = await decrypt(encrypted, key);
                  return decryptedMsg;
                })
              );
              const parsedMessages = decrypted
                .filter((msg): msg is string => msg !== null)
                .map((msg) => {
                  try {
                    return JSON.parse(msg);
                  } catch {
                    return { text: msg, sender: 'Unknown' };
                  }
                });
              setMessages(parsedMessages);
            } catch (err: unknown) {
              const errorMessage = err instanceof Error ? err.message : 'Unknown error';
              setError('Failed to decrypt real-time update: ' + errorMessage);
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            retryCount = 0;
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            if (retryCount < maxRetries) {
              retryCount++;
              setTimeout(subscribeWithRetry, 2000);
            }
          }
        });
      return channel;
    };

    const channel = subscribeWithRetry();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, key, router]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  async function sendMessage() {
    if (!newMessage || !id || !key) {
      setError('Message, ID, or key missing');
      return;
    }
    try {
      const messageObj = { text: newMessage, sender: username };
      const encrypted = await encrypt(JSON.stringify(messageObj), key);
      const currentMessages = await fetchMessages();
      const updatedMessages = [...currentMessages, encrypted];
      const { error: updateError } = await supabase
        .from('rooms')
        .update({ messages: updatedMessages })
        .eq('id', id);
      if (updateError) throw new Error('Supabase update failed: ' + updateError.message);
      setNewMessage('');
      setError(null);
      scrollToBottom();
      // Use setTimeout to ensure focus works on mobile after state updates
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError('Failed to encrypt or send message: ' + errorMessage);
    }
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id || !key) {
      setError('File, ID, or key missing');
      return;
    }
  
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      console.log('Session Data:', session, 'Session Error:', sessionError);
  
      const arrayBuffer = await file.arrayBuffer();
      const encryptedBlob = await encryptFile(arrayBuffer, key);
      const filePath = `${id}/${Date.now()}_${file.name}.enc`;
      
      console.log('Uploading photo to path:', filePath, 'File type:', file.type, 'File size:', file.size);
  
      const { data, error: uploadError } = await supabase.storage
        .from('chat-files')
        .upload(filePath, encryptedBlob, {
          contentType: file.type,
          upsert: true,
        });
      
      if (uploadError) {
        console.error('Upload Error Details:', uploadError);
        throw new Error('Upload failed: ' + uploadError.message);
      }
  
      if (data) {
        const fileUrl = supabase.storage.from('chat-files').getPublicUrl(filePath).data.publicUrl;
        const messageObj = { text: `Photo: ${fileUrl}`, sender: 'Anonymous' };
        const encryptedMessage = await encrypt(JSON.stringify(messageObj), key);
        const updatedMessages = [...(await fetchMessages()), encryptedMessage];
        const { error: updateError } = await supabase
          .from('rooms')
          .update({ messages: updatedMessages })
          .eq('id', id);
        if (updateError) throw new Error('Supabase update failed: ' + updateError.message);
        setError(null);
        scrollToBottom();
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError('Failed to encrypt or upload photo: ' + errorMessage);
      console.error('Full Error:', err);
    }
  }

  function base64Encode(bytes: Uint8Array): string {
    const binary = String.fromCharCode(...bytes);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64Decode(str: string): Uint8Array {
    const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }

  async function encrypt(text: string, keyBase64: string) {
    try {
      const keyBytes = base64Decode(keyBase64);
      const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        'AES-GCM',
        false,
        ['encrypt']
      );

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encodedText = new TextEncoder().encode(text);
      const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encodedText
      );

      const encryptedBytes = new Uint8Array(encryptedBuffer);
      const combined = new Uint8Array(iv.length + encryptedBytes.length);
      combined.set(iv);
      combined.set(encryptedBytes, iv.length);

      return base64Encode(combined);
    } catch (err) {
      throw err;
    }
  }

  async function decrypt(encryptedBase64: string, keyBase64: string) {
    try {
      const encryptedBytes = base64Decode(encryptedBase64);
      const iv = encryptedBytes.slice(0, 12);
      const ciphertext = encryptedBytes.slice(12);

      const keyBytes = base64Decode(keyBase64);
      const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        'AES-GCM',
        false,
        ['decrypt']
      );

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      );

      return new TextDecoder().decode(decryptedBuffer);
    } catch (err) {
      throw err;
    }
  }

  async function encryptFile(buffer: ArrayBuffer, keyBase64: string) {
    try {
      const keyBytes = base64Decode(keyBase64);
      const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        'AES-GCM',
        false,
        ['encrypt']
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buffer);
      return new Blob([iv, new Uint8Array(encrypted)]);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      throw new Error('File encryption failed: ' + errorMessage);
    }
  }

  async function fetchMessages() {
    const { data } = await supabase.from('rooms').select('messages').eq('id', id).single();
    return data?.messages || [];
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const shareLink = () => {
    if (navigator.share) {
      navigator.share({
        title: 'VanishTalk Room',
        url: roomUrl,
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(roomUrl);
      alert('Link copied to clipboard!');
    }
  };

  const toggleTheme = () => {
    setIsDarkTheme(!isDarkTheme);
  };

  return (
    <div className={`h-screen w-screen flex flex-col ${isDarkTheme ? 'bg-gray-900 text-white' : 'bg-gray-100 text-black'}`}>
      {/* Fixed Header */}
      <div className={`fixed top-0 left-0 right-0 z-10 p-4 border-b ${isDarkTheme ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} flex justify-between items-center`}>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => router.push('/')}
            className="p-2 hover:bg-gray-700 rounded-full transition-colors"
            title="Back to Home"
          >
            <ArrowLeft className={`w-6 h-6 ${isDarkTheme ? 'text-gray-300' : 'text-gray-600'}`} />
          </button>
          <h1 className={`text-xl font-semibold truncate max-w-[40vw] ${isDarkTheme ? 'text-gray-200' : 'text-gray-800'}`}>
            Room {id || 'Loading...'}
          </h1>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={shareLink}
            className="p-2 hover:bg-gray-700 rounded-full transition-colors"
            title="Share Room Link"
          >
            <Share2 className={`w-7 h-7 ${isDarkTheme ? 'text-gray-300' : 'text-gray-600'}`} />
          </button>
          <button
            onClick={() => setShowQRCode(!showQRCode)}
            className="p-2 hover:bg-gray-700 rounded-full transition-colors"
            title="Show QR Code"
          >
            <svg className={`w-7 h-7 ${isDarkTheme ? 'text-gray-300' : 'text-gray-600'}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h8v8H3zm2 2v4h4V5zm-2 8h8v8H3zm2 2v4h4v-4zm8-10h8v8h-8zm2 2v4h4V7zm4 6v2h-2v-2zm-4 2h2v2h-2zm2 2v2h-2v-2zm-2 2h2v2h-2zm4-6h2v6h-2zm2 8v-2h2v2z"/>
            </svg>
          </button>
          <button
            onClick={toggleTheme}
            className="p-2 hover:bg-gray-700 rounded-full transition-colors"
            title="Toggle Theme"
          >
            {isDarkTheme ? (
              <Sun className="w-6 h-6 text-gray-300" />
            ) : (
              <Moon className="w-6 h-6 text-gray-600" />
            )}
          </button>
        </div>
      </div>

      {/* Main Content Wrapper for Desktop Card View */}
      <div className="flex justify-center flex-1 pt-[80px] pb-[80px]">
        <div className={`flex flex-col w-full md:max-w-3xl md:shadow-lg md:rounded-lg ${isDarkTheme ? 'md:bg-gray-800' : 'md:bg-white'}`}>
          {/* QR Code Modal */}
          {showQRCode && (
            <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
              <div className="bg-white p-6 rounded-lg">
                <QRCode value={roomUrl} size={250} />
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowQRCode(false)}
                    className="mt-4 px-4 py-2 bg-teal-600 text-white rounded-lg"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <p className={`p-4 text-sm ${isDarkTheme ? 'text-red-400 bg-red-900/50' : 'text-red-600 bg-red-100'}`}>
              {error}
            </p>
          )}

          {/* Messages Area */}
          <div 
            ref={messagesContainerRef}
            className={`flex-1 overflow-y-auto ${isDarkTheme ? 'bg-gray-800' : 'bg-gray-50'} touch-auto pt-16`}
            style={{
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
              scrollBehavior: 'smooth'
            }}
          >
            <div className="p-4">
              {messages.length === 0 ? (
                <p className={`text-center ${isDarkTheme ? 'text-gray-400' : 'text-gray-500'}`}>No messages yet.</p>
              ) : (
                messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`mb-3 p-3 rounded-lg max-w-[80%] break-words ${
                      msg.sender === username
                        ? 'bg-teal-500 text-white ml-auto'
                        : `${isDarkTheme ? 'bg-gray-700 text-gray-200' : 'bg-teal-100 text-gray-800'}`
                    }`}
                  >
                    <span className="text-xs block mb-1 opacity-75">{msg.sender}</span>
                    {msg.text}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Footer */}
      <div className={`fixed bottom-0 left-0 right-0 p-4 border-t ${isDarkTheme ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} z-10`}>
        <div className="flex justify-center">
          <div className="flex items-center space-x-2 w-full md:max-w-3xl">
            <label className="cursor-pointer">
              <Paperclip className={`w-6 h-6 ${isDarkTheme ? 'text-teal-400 hover:text-teal-300' : 'text-teal-700 hover:text-teal-900'} transition-colors`} />
              <input
                type="file"
                onChange={uploadFile}
                className="hidden"
              />
            </label>
            <input
              ref={inputRef}
              autoFocus // Added autoFocus to help mobile behavior
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className={`flex-1 p-2 border ${isDarkTheme ? 'border-gray-600 bg-gray-700 text-gray-200 placeholder-gray-400' : 'border-gray-300 bg-white text-black placeholder-gray-500'} rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500`}
            />
            <button
              onClick={sendMessage}
              className={`px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:bg-gray-400`}
              disabled={!newMessage || !id || !key}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}