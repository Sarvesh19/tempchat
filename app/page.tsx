"use client";

import { useRouter } from "next/navigation";
import { supabase } from '../lib/supabase';
import { useState } from 'react';

export default function Home() {
  const router = useRouter();
  const [expiryHours, setExpiryHours] = useState(24); // Default 24 hours

  async function createRoom() {
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    const { data, error } = await supabase
      .from('rooms')
      .insert({ expires_at: expiresAt.toISOString() })
      .select('id')
      .single();

    if (error) {
      console.error('Error creating room:', error);
      return;
    }

    if (data) {
      const key = await generateKey(data.id);
      const safeKey = encodeURIComponent(key);
      router.push(`/room/${data.id}?key=${safeKey}`);
    }
  }

  async function generateKey(roomId: string) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(roomId),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('salt'),
        iterations: 1000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const exportedKey = await crypto.subtle.exportKey('raw', key);
    const base64Key = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));
    return base64Key.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-gray-800 mb-6">
          VanishTalk
        </h1>
        <p className="text-lg text-gray-600 mb-8">
          Create private, temporary chat rooms that vanish after your chosen time.
        </p>
        <div className="mb-6">
          <label className="block text-sm text-gray-600 mb-2">
            Room expires after:
          </label>
          <select
            value={expiryHours}
            onChange={(e) => setExpiryHours(Number(e.target.value))}
            className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours</option>
            <option value={48}>48 hours</option>
            <option value={72}>72 hours</option>
          </select>
        </div>
        <button
          onClick={createRoom}
          className="px-6 py-3 bg-teal-600 text-white text-lg font-semibold rounded-lg shadow-md hover:bg-teal-700 transition-colors duration-200"
        >
          Create a Room
        </button>
      </div>
    </div>
  );
}