'use client';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { apiFetch as fetch } from '../../lib/client-request';
import type { OrganizerAccount } from '../../lib/organizer-accounts';

export function OrganizerLogin({ onLogin, onBusyChange }: { onLogin: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [forced, setForced] = useState<OrganizerAccount | null>(null);
  const errorId = useId();

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/organizers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to sign in.');
      setPassword('');
      if (data.actor.must_change) setForced(data.actor);
      else await onLogin();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  if (forced) {
    return (
      <section className="organizer-login">
        <p role="status">Change your initial password before continuing.</p>
        <AccountEditor actor={forced} user={forced} onBusyChange={onBusyChange} onSaved={() => {
          setForced(null);
          setMessage('Password changed. Sign in with your new password.');
        }} />
      </section>
    );
  }

  return (
    <div className="organizer-login">
      <form onSubmit={signIn} aria-busy={busy}>
        <label>Username
          <input autoComplete="username" autoCapitalize="none" value={username} required maxLength={80} disabled={busy}
            aria-describedby={error ? errorId : undefined} onChange={event => { setUsername(event.target.value); setError(''); }} />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" value={password} required maxLength={256} disabled={busy}
            aria-describedby={error ? errorId : undefined} onChange={event => { setPassword(event.target.value); setError(''); }} />
        </label>
        {error && <p id={errorId} className="staff-access-error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
function AccountEditor({actor,user,onSaved,blocked=false,onBusyChange}:{actor:OrganizerAccount;user:OrganizerAccount;onSaved:()=>void;blocked?:boolean;onBusyChange?:(busy:boolean)=>void}) {
  const [username,setUsername]=useState(user.username),[currentPassword,setCurrent]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const own=actor.id===user.id;
  async function save(reset = false) {
    if (busy || blocked) return;
    if (own && password !== confirm) {
      setMessage('The new passwords do not match.');
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setMessage('');
    try {
      const response = await fetch('/api/organizers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: reset ? 'reset' : 'update', id: user.id, username, currentPassword, ...(own ? { password } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCurrent('');
      setPassword('');
      setConfirm('');
      if (data.initialPassword) setMessage(`Initial password (shown once): ${data.initialPassword}`);
      else {
        setMessage('Account updated. Changed accounts must sign in again.');
        onSaved();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update account.');
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return <form className="account-editor" onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy||blocked}><legend>{own?'Your account':user.username}</legend><label>Username<input autoComplete="off" readOnly={Boolean(actor.read_only)} required value={username} maxLength={80} onChange={e=>setUsername(e.target.value)} /></label><label>Your current password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e=>setCurrent(e.target.value)} /></label>{own&&<><label>New password<input type="password" autoComplete="new-password" minLength={14} maxLength={256} required={Boolean(actor.must_change)} value={password} onChange={e=>setPassword(e.target.value)} /></label><label>Confirm new password<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} /></label><small>Use at least 14 characters. Leave blank to change only your username.</small></>}<button className="primary">Save account</button>{!own&&<button type="button" className="secondary" onClick={()=>void save(true)}>Generate reset password</button>}</fieldset>{message&&<p role="status" className="account-secret">{message}</p>}</form>;
}
type Event={id:number;username:string;at:string;action:string;outcome:string};
export function OrganizerAccounts({pin,configured,onSignOut,blocked=false}:{pin:string;configured:boolean;onSignOut:()=>void;blocked?:boolean}) {
  const [actor,setActor]=useState<OrganizerAccount|null>(null),[users,setUsers]=useState<OrganizerAccount[]>([]),[events,setEvents]=useState<Event[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[credentials,setCredentials]=useState<{username:string;password:string}[]>([]);
  async function load(){setBusy(true);try{const response=await fetch('/api/organizers');const data=await response.json();if(!response.ok)throw new Error(data.error);setActor(data.actor);setUsers(data.users);if(data.actor.manager||data.actor.read_only){const audit=await fetch('/api/organizers?audit=1');const result=await audit.json();if(!audit.ok)throw new Error(result.error);setEvents(result.events);}}catch(error){setMessage(error instanceof Error?error.message:'Unable to load accounts.');}finally{setBusy(false);}}
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active&&configured)void load();});return()=>{active=false;};},[configured]);
  if(!configured)return <section className="card"><h2>Set up organizer accounts</h2><p>Create carl.taboada, erin.kizel and regin.povz as account managers, and racketeers for view-only organizer access. This replaces organizer PIN access. Each initial password is shown once and must be changed at first sign-in.</p><p>Save a current private tournament backup first. Account tables and audit history are separate from tournament JSON backups.</p><button className="primary" disabled={busy||blocked||Boolean(credentials.length)} onClick={async()=>{setBusy(true);try{const response=await fetch('/api/organizers',{method:'POST',headers:{'content-type':'application/json','x-organizer-pin':pin},body:JSON.stringify({action:'activate'})});const data=await response.json();if(!response.ok)throw new Error(data.error);setCredentials(data.credentials);}catch(error){setMessage(error instanceof Error?error.message:'Unable to set up accounts.');}finally{setBusy(false);}}}>Create the four organizer accounts</button>{credentials.length>0&&<div className="account-secret" role="status"><h3>Save these initial passwords privately</h3>{credentials.map(c=><p key={c.username}><strong>{c.username}</strong><br/><code>{c.password}</code></p>)}<button type="button" onClick={onSignOut}>Saved passwords — go to sign-in</button></div>}{message&&<p role="alert">{message}</p>}</section>;
  return <section className="stack organizer-accounts"><header><h2>User management</h2><p>Change your own sign-in details. Account managers can rename accounts and generate reset passwords. Existing sessions end when credentials change.</p><button className="secondary" disabled={busy} onClick={()=>void load()}>Refresh accounts and history</button></header>{message&&<p role="status">{message}</p>}{actor&&users.map(user=><details key={`${user.id}:${user.username}`} className="card"><summary>{user.username} — {user.manager?'Account manager':user.read_only?'View only':'Tournament organizer'}</summary><AccountEditor blocked={blocked} actor={actor} user={user} onSaved={()=>{if(actor.id===user.id)onSignOut();else void load();}} /></details>)}{actor && (actor.manager||actor.read_only) ? <section className="card"><h3>Organizer audit trail</h3><p>Times are Philippine time. Pending means a change was attempted but its final outcome could not be recorded. Shared-account entries identify racketeers, not an individual.</p><div className="table-wrap"><table><thead><tr><th>Date and time</th><th>User</th><th>Action</th><th>Outcome</th></tr></thead><tbody>{events.map(event=><tr key={event.id}><td>{new Date(event.at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})}</td><td>{event.username}</td><td>{event.action}</td><td>{event.outcome}</td></tr>)}</tbody></table></div>{!events.length&&<p>No organizer activity recorded yet.</p>}{events.length>=100&&<button disabled={busy} className="secondary" onClick={async()=>{setBusy(true);try{const response=await fetch(`/api/organizers?audit=1&before=${events.at(-1)!.id}`);const data=await response.json();if(!response.ok)throw new Error(data.error);setEvents(current=>[...current,...data.events]);}catch{setMessage('Unable to load earlier history.');}finally{setBusy(false);}}}>Load earlier history</button>}</section>:<p>Audit history is available to account managers.</p>}</section>;
}
