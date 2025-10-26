import React, { useState, useMemo, useEffect } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import BottomNavBar from './components/BottomNavBar';
import CollegeView from './components/CollegeView';
import QASession from './components/QASession';
import VisionView from './components/VisionView';
import WebClipsView from './components/WebClipsView';
import VoiceNotesView from './components/RecordingList';
import UpdateNotification from './components/UpdateNotification';
import Login from './components/Login';
import { useRecordings } from './hooks/useRecordings';
import { useServiceWorker } from './hooks/useServiceWorker';
import type { AnyMemory, WebMemory } from './types';
import { getFirebase } from './utils/firebase';
import { LogOutIcon } from './components/Icons';

type View = 'physical' | 'college' | 'webclips' | 'askai' | 'voicenotes';

const viewTitles: Record<View, string> = {
    physical: 'Physical Items',
    college: 'College',
    webclips: 'Web Clips',
    askai: 'Ask AI',
    voicenotes: 'Voice Notes',
};

function App() {
  const [view, setView] = useState<View>('college');
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);

  const { memories, addMemory, deleteMemory, updateMemory, syncSharedClips, pendingClipsCount, bulkDeleteMemories, courses, addCourse } = useRecordings(user);
  const { updateAvailable, updateServiceWorker } = useServiceWorker();
  
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    getFirebase().then(({ auth }) => {
        unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setAuthLoading(false);
        });
    }).catch(err => {
        console.error("Failed to init Firebase for auth", err);
        if (err instanceof Error) {
            setFirebaseError(err.message);
        } else {
            setFirebaseError("An unknown error occurred during Firebase initialization.");
        }
        setAuthLoading(false);
    });

    return () => unsubscribe && unsubscribe();
  }, []);

  const handleSignOut = async () => {
    try {
        const { auth } = await getFirebase();
        await signOut(auth);
    } catch (error) {
        console.error("Sign out failed", error);
    }
  };

  const collegeMemories = useMemo(() => memories.filter(m => m.category === 'college'), [memories]);
  const physicalMemories = useMemo(() => memories.filter(m => m.type === 'item' || m.type === 'video'), [memories]);
  const webClipMemories = useMemo(() => memories.filter(m => m.type === 'web'), [memories]);
  const voiceNoteMemories = useMemo(() => memories.filter(m => m.type === 'voice' && m.category === 'personal'), [memories]);

  const handleUpdateMemory = (id: string, updates: Partial<AnyMemory>) => {
    updateMemory(id, updates);
  };
  
  const handleUpdateWebClip = (id: string, updates: Partial<WebMemory>) => {
    updateMemory(id, updates);
  }

  if (authLoading) {
    return (
        <div className="flex items-center justify-center h-full bg-gray-900 text-white">
            <p>Loading...</p>
        </div>
    );
  }

  if (!user) {
    return <Login error={firebaseError} />;
  }

  const renderView = () => {
    switch (view) {
      case 'physical':
        return <VisionView memories={physicalMemories} onDelete={deleteMemory} onUpdate={handleUpdateMemory} onSave={addMemory} bulkDelete={bulkDeleteMemories} />;
      case 'college':
        return <CollegeView lectures={collegeMemories} onDelete={deleteMemory} onUpdate={handleUpdateMemory} onSave={addMemory} bulkDelete={bulkDeleteMemories} courses={courses} addCourse={addCourse} />;
      case 'webclips':
        return <WebClipsView memories={webClipMemories} onDelete={deleteMemory} onUpdate={handleUpdateWebClip} onSave={addMemory} syncSharedClips={syncSharedClips} pendingClipsCount={pendingClipsCount} bulkDelete={bulkDeleteMemories}/>;
      case 'askai':
        return <QASession memories={memories} />;
      case 'voicenotes':
        return <VoiceNotesView memories={voiceNoteMemories} onSave={addMemory} onDelete={deleteMemory} onUpdate={handleUpdateMemory} bulkDelete={bulkDeleteMemories} />;
      default:
        return <QASession memories={memories} />;
    }
  };

  return (
    <div className="grid grid-rows-[auto_1fr_auto] h-full bg-gray-900 text-white">
      <header className="p-4 text-center bg-gray-800 border-b border-gray-700 flex justify-between items-center">
        <div className="w-10"></div> {/* Spacer */}
        <h1 className="text-2xl font-bold tracking-wider">{viewTitles[view]}</h1>
        <button onClick={handleSignOut} className="p-2 rounded-full hover:bg-gray-700" aria-label="Sign out">
            <LogOutIcon className="w-6 h-6 text-gray-400" />
        </button>
      </header>
      <main className="p-4 sm:p-6 overflow-y-auto">
        {renderView()}
      </main>
      <BottomNavBar view={view} setView={setView} />
      {updateAvailable && <UpdateNotification onUpdate={updateServiceWorker} />}
    </div>
  );
}

export default App;
