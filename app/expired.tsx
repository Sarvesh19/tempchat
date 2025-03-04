import { useRouter } from 'next/router';

export default function Expired() {
  const router = useRouter();

  return (
    <div style={{ textAlign: 'center', padding: '50px' }}>
      <h1>This Room Has Expired</h1>
      <p>The chat room you tried to access is no longer available.</p>
      <button
        onClick={() => router.push('/')}
        style={{ padding: '10px 20px', marginTop: '20px', cursor: 'pointer' }}
      >
        Back to Home
      </button>
    </div>
  );
}