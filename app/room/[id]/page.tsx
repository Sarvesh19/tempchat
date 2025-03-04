'use client';

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../lib/supabase';

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
  const [username, setUsername] = useState<string>(''); // Initially empty
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Generate username only on the client side
  useEffect(() => {
    if (!username) {
      setUsername(generateRandomName());
    }
  }, [username]);

  useEffect(() => {
    console.log('ID from params:', id);
    console.log('Raw key from searchParams:', rawKey);
    console.log('Decoded key:', key);

    if (!id || !key) {
      setError('Room ID or key missing');
      return;
    }

    try {
      base64Decode(key);
      console.log('Key validated successfully');
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
      console.log('Fetched data from Supabase:', data, 'Error:', error);
      if (error) {
        setError('Failed to fetch messages: ' + error.message);
        return;
      }
      if (data?.messages) {
        try {
          const decrypted = await Promise.all(
            data.messages.map(async (encrypted: string) => {
              const decryptedMsg = await decrypt(encrypted, key);
              console.log('Decrypted message:', decryptedMsg);
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
          console.log('Parsed messages:', parsedMessages);
          setMessages(parsedMessages);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          setError('Failed to decrypt messages: ' + errorMessage);
        }
      }
    };
    fetchAndDecrypt();

    // Real-time subscription with retry logic
    let retryCount = 0;
    const maxRetries = 5;
    const subscribeWithRetry = () => {
      const channel = supabase
        .channel(`room:${id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` },
          async (payload) => {
            console.log('Real-time update received:', payload);
            try {
              const decrypted = await Promise.all(
                payload.new.messages.map(async (encrypted: string) => {
                  const decryptedMsg = await decrypt(encrypted, key);
                  console.log('Decrypted real-time message:', decryptedMsg);
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
              console.log('Parsed real-time messages:', parsedMessages);
              setMessages(parsedMessages);
            } catch (err: unknown) {
              const errorMessage = err instanceof Error ? err.message : 'Unknown error';
              setError('Failed to decrypt real-time update: ' + errorMessage);
            }
          }
        )
        .subscribe((status, err) => {
          console.log('Subscription status:', status, 'Error:', err);
          if (status === 'SUBSCRIBED') {
            console.log('Successfully subscribed to real-time updates for room:', id);
            retryCount = 0; // Reset retry count on success
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            if (retryCount < maxRetries) {
              retryCount++;
              console.log(`Retrying subscription (${retryCount}/${maxRetries}) in 2 seconds...`);
              setTimeout(subscribeWithRetry, 2000);
            }
          }
        });
      scrollToBottom();
      return channel;
    };

    const channel = subscribeWithRetry();

    return () => {
      console.log('Unsubscribing from channel');
      supabase.removeChannel(channel);
    };
  }, [id, key, router, messages]);

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
      const { data, error: updateError } = await supabase
        .from('rooms')
        .update({ messages: updatedMessages })
        .eq('id', id)
        .select();
      if (updateError) throw new Error('Supabase update failed: ' + updateError.message);
      setNewMessage('');
      setError(null);
      scrollToBottom();
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
      const arrayBuffer = await file.arrayBuffer();
      const encryptedBlob = await encryptFile(arrayBuffer, key);
      const filePath = `${id}/${Date.now()}_${file.name}.enc`;
      console.log('Uploading file to:', filePath);

      const { data: userData, error: authError } = await supabase.auth.getUser();
      console.log('Auth status:', userData, 'Auth error:', authError);
      if (authError && authError.message.includes('not authenticated')) {
        setError('User not authenticated. Please log in to upload files.');
        return;
      }

      const { data, error: uploadError } = await supabase.storage
        .from('chat-files')
        .upload(filePath, encryptedBlob, {
          contentType: file.type,
          upsert: true,
        });
      console.log('Upload result:', data, 'Error:', uploadError);
      if (uploadError) throw new Error('Upload failed: ' + uploadError.message);

      if (data) {
        const fileUrl = supabase.storage.from('chat-files').getPublicUrl(filePath).data.publicUrl;
        const messageObj = { text: `File: ${fileUrl}`, sender: username };
        console.log('File message object:', messageObj);
        const encryptedMessage = await encrypt(JSON.stringify(messageObj), key);
        const updatedMessages = [...(await fetchMessages()), encryptedMessage];
        const { error: updateError } = await supabase
          .from('rooms')
          .update({ messages: updatedMessages })
          .eq('id', id);
        if (updateError) throw new Error('Supabase update failed: ' + updateError.message);
        console.log('File message sent successfully');
        setError(null);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError('Failed to encrypt or upload file: ' + errorMessage);
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
      console.error('Encryption error:', err);
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
      console.error('Decryption error:', err);
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

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-md flex flex-col h-[80vh]">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h1 className="text-xl font-semibold text-gray-800">
            Room {id || 'Loading...'}
          </h1>
          <span className="text-sm text-gray-600">
            You are: {username || 'Loading...'}
          </span>
        </div>
        {error && (
          <p className="mx-4 mt-2 text-sm text-red-600 bg-red-100 p-2 rounded">
            {error}
          </p>
        )}

        {/* Messages Area */}
        <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
          {messages.length === 0 ? (
            <p className="text-gray-500 text-center">No messages yet.</p>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`mb-3 p-3 rounded-lg max-w-[80%] break-words ${
                  msg.sender === username
                    ? 'bg-teal-500 text-white ml-auto'
                    : 'bg-teal-100 text-gray-800'
                }`}
              >
                <span className="text-xs block mb-1 opacity-75">{msg.sender}</span>
                {msg.text}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-gray-200 bg-white">
          <div className="flex items-center space-x-2">
            <input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button
              onClick={sendMessage}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:bg-gray-400"
              disabled={!newMessage || !id || !key}
            >
              Send
            </button>
          </div>
          <div className="mt-2">
            <label className="block">
              <span className="text-sm text-gray-600">Upload a file:</span>
              <input
                type="file"
                onChange={uploadFile}
                className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}