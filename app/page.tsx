"use client";

import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { useState } from "react";
import { Clock, Link, QrCode, Share2, Users, Trash2, Paperclip, ArrowRight } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [expiryHours, setExpiryHours] = useState(24);
  const [roomUrl, setRoomUrl] = useState("");
  const [showQR, setShowQR] = useState(false);

  async function createRoom() {
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    const { data, error } = await supabase
      .from("rooms")
      .insert({ expires_at: expiresAt.toISOString() })
      .select("id")
      .single();
  
    if (error) {
      console.error("Error creating room:", error);
      return;
    }
  
    if (data) {
      const key = await generateKey(data.id);
      const safeKey = encodeURIComponent(key);
      const url = `${window.location.origin}/room/${data.id}?key=${safeKey}`;
      
      // Redirect to the new room
      window.location.href = url;
      
      // If you still want to show QR (optional, remove if redirecting immediately)
      // setRoomUrl(url);
      // setShowQR(true);
    }
  }
  

  async function generateKey(roomId: string) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(roomId),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: encoder.encode("salt"),
        iterations: 1000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const exportedKey = await crypto.subtle.exportKey("raw", key);
    const base64Key = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));
    return base64Key.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const shareRoom = async () => {
    if (navigator.share && roomUrl) {
      try {
        await navigator.share({
          title: "TempChat Room",
          text: "Join my private chat room on TempChat!",
          url: roomUrl,
        });
      } catch (err) {
        console.error("Error sharing:", err);
      }
    } else {
      navigator.clipboard.writeText(roomUrl);
      alert("Room URL copied to clipboard!");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-gray-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-4xl w-full">
        {/* Header */}
        <h1 className="text-4xl md:text-5xl font-extrabold text-teal-700 mb-4 text-center">
        TempChat
        </h1>
        <p className="text-lg text-gray-600 mb-8 text-center">
          Create secure, temporary chat rooms that vanish after your chosen time.
        </p>

        {/* Main Content: Room Creation and How to Use */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Room Creation Section */}
          <div className="flex flex-col items-center">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">Create Your Room</h2>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Room expires after:
            </label>
            <div className="relative inline-block w-full max-w-xs">
              <select
                value={expiryHours}
                onChange={(e) => setExpiryHours(Number(e.target.value))}
                className="appearance-none w-full p-3 pl-10 pr-8 border border-gray-300 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 transition duration-200"
              >
                <option value={6}>6 hours</option>
                <option value={12}>12 hours</option>
                <option value={24}>24 hours</option>
                <option value={48}>48 hours</option>
                <option value={72}>72 hours</option>
              </select>
              <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            </div>
            <button
  onClick={createRoom}
  className="mt-6 px-4 py-2 text-teal-700 font-semibold rounded-lg hover:text-teal-900 focus:outline-none focus:ring-2 focus:ring-teal-500 transition duration-200 flex items-center gap-2"
>
  Create Room
  <ArrowRight className="w-5 h-5" />
</button>

            {/* Room URL and QR Code */}
            {roomUrl && (
              <div className="mt-6 p-6 bg-teal-50 rounded-lg shadow-inner w-full">
                <p className="text-gray-700 font-medium mb-4 text-center">Your room is ready!</p>
                <div className="flex flex-col items-center gap-4">
                  <div className="flex flex-wrap items-center justify-center gap-4">
                    <a
                      href={roomUrl}
                      className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition duration-200"
                    >
                      <Link size={18} /> Join Now
                    </a>
                    <button
                      onClick={shareRoom}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition duration-200"
                    >
                      <Share2 size={18} /> Share
                    </button>
                    <button
                      onClick={() => setShowQR(!showQR)}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition duration-200"
                    >
                      <QrCode size={18} /> {showQR ? "Hide QR" : "Show QR"}
                    </button>
                  </div>
                  {showQR && (
                    <div className="mt-4 text-center">
                      {/* Uncomment when QRCode is added */}
                      {/* <QRCode value={roomUrl} size={150} /> */}
                      <p className="text-sm text-gray-500 mt-2">Scan to join the room</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* How to Use Section */}
          <div className="flex flex-col">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4 text-center md:text-left">
              How to Use TempChat
            </h2>
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <Clock className="text-teal-600 flex-shrink-0" size={24} />
                <div>
                  <h3 className="text-lg font-medium text-gray-800">1. Set Expiration</h3>
                  <p className="text-gray-600">Choose how long your room will last (6-72 hours).</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <Link className="text-teal-600 flex-shrink-0" size={24} />
                <div>
                  <h3 className="text-lg font-medium text-gray-800">2. Create Room</h3>
                  <p className="text-gray-600">Click "Create Room" to generate a unique link.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <Share2 className="text-teal-600 flex-shrink-0" size={24} />
                <div>
                  <h3 className="text-lg font-medium text-gray-800">3. Share It</h3>
                  <p className="text-gray-600">Use the share button or QR code to invite others.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <Users className="text-teal-600 flex-shrink-0" size={24} />
                <div>
                  <h3 className="text-lg font-medium text-gray-800">4. Join & Chat</h3>
                  <p className="text-gray-600">Click "Join Now" or scan the QR code to start chatting.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <Trash2 className="text-teal-600 flex-shrink-0" size={24} />
                <div>
                  <h3 className="text-lg font-medium text-gray-800">5. Auto-Vanish</h3>
                  <p className="text-gray-600">Room disappears automatically after the set time.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Link */}
        <div className="mt-10 flex justify-center">
          <a
            href="https://example.com/learn-more"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-teal-600 hover:text-teal-800 transition duration-200"
          >
            <Paperclip size={18} /> Learn More
          </a>
        </div>
      </div>
    </div>
  );
}