import { useEffect, useState } from "react";

type Role = "admin" | "manager" | "chatter";

interface User {
  id: number;
  name: string;
  role: Role;
  email: string;
}

interface Model {
  id: number;
  name: string;
  voices: { id: number; elevenlabsVoiceId: string; status: string }[];
}

const TOKEN_KEY = "essenza_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function api(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  return res;
}

export default function App() {
  const [token, setToken] = useState<string | null>(getToken());
  const [user, setUser] = useState<User | null>(null);

  if (!token) {
    return <Login onLogin={(t) => { setToken(t); localStorage.setItem(TOKEN_KEY, t); }} />;
  }

  return <Panel token={token} onLogout={() => { localStorage.removeItem(TOKEN_KEY); setToken(null); setUser(null); }} user={user} setUser={setUser} />;
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState("admin@essenza.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Error al iniciar sesión");
      return;
    }
    onLogin(data.token);
  }

  return (
    <main className="min-h-screen bg-stone-100 flex items-center justify-center">
      <form onSubmit={submit} className="bg-white rounded-lg shadow p-8 w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold text-stone-800">Essenza — Verificar API</h1>
        <div>
          <label className="block text-sm text-stone-600 mb-1">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm text-stone-600 mb-1">Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border rounded px-3 py-2" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full bg-stone-800 text-white rounded py-2 font-medium">Iniciar sesión</button>
        <p className="text-xs text-stone-500">Seed: admin@essenza.com / manager@essenza.com / chatter@essenza.com</p>
      </form>
    </main>
  );
}

function Panel({ token, onLogout, user, setUser }: { token: string; onLogout: () => void; user: User | null; setUser: (u: User) => void }) {
  const [models, setModels] = useState<Model[] | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [phrases, setPhrases] = useState<any[] | null>(null);

  useEffect(() => {
    (async () => {
      const me = await api("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@essenza.com", password: "password123" }),
      });
      const meData = await me.json();
      if (meData.user) setUser(meData.user);
    })();
    refreshAll();
  }, []);

  async function refreshAll() {
    const [m, s, p] = await Promise.all([api("/api/models"), api("/api/usage/summary"), api("/api/phrases")]);
    if (m.ok) setModels(await m.json());
    if (s.ok) setSummary(await s.json());
    if (p.ok) setPhrases(await p.json());
  }

  return (
    <main className="min-h-screen bg-stone-100 p-8">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-stone-800">
          Essenza API check {user && <span className="text-sm text-stone-500">({user.name} · {user.role})</span>}
        </h1>
        <div className="flex items-center gap-4">
          <button onClick={refreshAll} className="bg-stone-800 text-white rounded px-4 py-2 text-sm">Refrescar</button>
          <button onClick={onLogout} className="bg-stone-300 rounded px-4 py-2 text-sm">Salir</button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium mb-3">Modelos</h2>
          {models === null && <p className="text-sm text-stone-500">Cargando...</p>}
          {models && (
            <ul className="space-y-2">
              {models.length === 0 && <li className="text-sm text-stone-500">Sin modelos.</li>}
              {models.map((m) => (
                <li key={m.id} className="text-sm border rounded p-2">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-stone-500"> · voces: {m.voices?.length ?? 0}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium mb-3">Uso</h2>
          {summary && (
            <div className="text-sm space-y-3">
              <div>
                <p className="font-medium text-stone-600 mb-1">Chatters hoy</p>
                {summary.byChatter.length === 0 && <p className="text-stone-500">Sin uso.</p>}
                {summary.byChatter.map((r: any) => (
                  <p key={r.chatter_id}>{r.name}: {r.chars_today} chars</p>
                ))}
              </div>
              <div>
                <p className="font-medium text-stone-600 mb-1">Modelos este mes</p>
                {summary.byModel.length === 0 && <p className="text-stone-500">Sin uso.</p>}
                {summary.byModel.map((r: any) => (
                  <p key={r.model_id}>{r.name}: {r.chars_this_month} chars</p>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium mb-3">Frases</h2>
          {phrases && (
            <ul className="space-y-2 text-sm">
              {phrases.map((p) => (
                <li key={p.id} className="border rounded p-2">
                  <span className="font-medium">{p.label}</span>: {p.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <GenerateTest token={token} models={models} onDone={refreshAll} />
    </main>
  );
}

function GenerateTest({ token, models, onDone }: { token: string; models: Model[] | null; onDone: () => void }) {
  const [modelId, setModelId] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState("");

  async function submit() {
    setResult("");
    const res = await api("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_id: Number(modelId), text }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setResult(`Error ${res.status}: ${data.error}`);
      return;
    }
    const source = res.headers.get("X-Audio-Source");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    setResult(`OK (${source})`);
    setText("");
    onDone();
    const a = document.createElement("a");
    a.href = url;
    a.download = "audio.mp3";
    a.click();
  }

  return (
    <section className="bg-white rounded-lg shadow p-6 mt-6 max-w-2xl">
      <h2 className="text-lg font-medium mb-3">Generar audio</h2>
      <div className="space-y-3">
        <select value={modelId} onChange={(e) => setModelId(e.target.value)} className="w-full border rounded px-3 py-2">
          <option value="">— Elegí modelo —</option>
          {models?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Texto a generar..." className="w-full border rounded px-3 py-2" />
        <button onClick={submit} disabled={!modelId || !text} className="bg-stone-800 text-white rounded px-4 py-2 text-sm disabled:opacity-50">
          Generar
        </button>
        {result && <p className="text-sm text-stone-600">{result}</p>}
      </div>
    </section>
  );
}
