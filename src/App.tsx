/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { auth, db, signIn, logOut } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  setDoc, 
  serverTimestamp, 
  getDoc,
  getDocs,
  deleteDoc,
  collectionGroup,
  where
} from 'firebase/firestore';
import { 
  Plus, 
  LogOut, 
  LayoutDashboard, 
  Users, 
  Receipt, 
  Settings, 
  ChevronRight,
  Wallet,
  PieChart,
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  Filter,
  MoreVertical,
  Menu,
  X,
  Sun,
  Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Group, UserProfile } from './types';

// Components
import Dashboard from './components/Dashboard';
import GroupView from './components/GroupView';
import CreateGroupModal from './components/CreateGroupModal';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [dataDeletedPopup, setDataDeletedPopup] = useState(false);
  const [showWelcomePopup, setShowWelcomePopup] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  useEffect(() => {
    (window as any).openCreateGroupModal = () => setIsCreateModalOpen(true);
    return () => {
      delete (window as any).openCreateGroupModal;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Check if user has seen welcome popup
        const hasSeenWelcome = localStorage.getItem(`hasSeenWelcome_${currentUser.uid}`);
        if (!hasSeenWelcome) {
          setShowWelcomePopup(true);
        }

        // Ensure user profile exists
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          try {
            await setDoc(userRef, {
              uid: currentUser.uid,
              displayName: currentUser.displayName,
              email: currentUser.email,
              photoURL: currentUser.photoURL,
              createdAt: serverTimestamp(),
            });
          } catch (error) {
            console.error("Error creating user profile:", error);
          }
        } else {
          const data = userSnap.data();
          const createdAt = data.createdAt?.toDate();
          if (createdAt && (Date.now() - createdAt.getTime() > 24 * 60 * 60 * 1000)) {
            try {
              // Delete all groups created by this user
              console.log("Checking for demo data reset...");
              const groupsQuery = query(collection(db, 'groups'), where('memberIds', 'array-contains', currentUser.uid));
              const groupsSnap = await getDocs(groupsQuery);
              console.log(`Found ${groupsSnap.docs.length} groups for user ${currentUser.uid}`);
              for (const groupDoc of groupsSnap.docs) {
                if (groupDoc.data().createdBy === currentUser.uid) {
                  console.log(`Deleting group ${groupDoc.id} due to demo reset`);
                  await deleteDoc(doc(db, 'groups', groupDoc.id));
                }
              }
              // Reset their createdAt
              await setDoc(userRef, {
                ...data,
                createdAt: serverTimestamp(),
              });
              // Show popup
              setDataDeletedPopup(true);
            } catch (error) {
              console.error("Error resetting demo data:", error);
            }
          }
        }

        // Test connection
        try {
          const { getDocFromServer } = await import('firebase/firestore');
          await getDocFromServer(doc(db, 'users', currentUser.uid));
          console.log("Firestore connection successful");
        } catch (error) {
          if (error instanceof Error && error.message.includes('offline')) {
            console.error("Firestore connection failed: client is offline");
          }
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setGroups([]);
      return;
    }

    // Query groups where the user is a member using the memberIds array
    const groupsQuery = query(
      collection(db, 'groups'),
      where('memberIds', 'array-contains', user.uid)
    );

    const unsubscribe = onSnapshot(groupsQuery, (snapshot) => {
      console.log(`Groups snapshot received: ${snapshot.docs.length} groups`);
      setLastError(null);
      const fetchedGroups = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Group));
      setGroups(fetchedGroups);
    }, (error) => {
      console.error("Error fetching groups:", error);
      setLastError(error.message);
      if (error.message.includes('Missing or insufficient permissions')) {
        console.warn("Permission denied for groups query. Check firestore.rules.");
        return;
      }
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (selectedGroupId && !groups.find(g => g.id === selectedGroupId)) {
      setSelectedGroupId(null);
    }
  }, [groups, selectedGroupId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 transition-colors duration-300">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white dark:bg-zinc-950 p-4 text-center relative overflow-hidden transition-colors duration-300">
        {/* Background Gradients */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute -top-1/4 -left-1/4 w-[80%] h-[80%] bg-indigo-600/10 dark:bg-indigo-600/20 rounded-full blur-[120px]" />
          <div className="absolute -bottom-1/4 -right-1/4 w-[80%] h-[80%] bg-fuchsia-600/10 dark:bg-fuchsia-600/20 rounded-full blur-[120px]" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-zinc-50/50 dark:bg-white/5 backdrop-blur-2xl p-8 sm:p-12 rounded-[48px] shadow-2xl border border-zinc-200 dark:border-white/10 relative z-10"
        >
          <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-br from-indigo-500 to-fuchsia-500 rounded-[32px] flex items-center justify-center mx-auto mb-8 sm:mb-10 shadow-2xl shadow-indigo-500/20">
            <Wallet className="w-10 h-10 sm:w-12 sm:h-12 text-white" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 text-zinc-900 dark:text-white font-display">Budgeted</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mb-8 sm:mb-12 leading-relaxed text-base sm:text-lg">The professional way to track expenses, split bills, and manage shared budgets.</p>
          <button
            onClick={signIn}
            className="w-full py-4 sm:py-5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all active:scale-[0.98] flex items-center justify-center gap-4 shadow-xl shadow-zinc-900/10 dark:shadow-white/10 text-base sm:text-lg outline-none focus:ring-4 focus:ring-indigo-500/40"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" className="w-6 h-6 bg-white rounded-full p-0.5" />
            Continue with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950 font-sans selection:bg-indigo-100 selection:text-indigo-900 relative overflow-hidden transition-colors duration-300">
      {/* Debug Overlay */}
      {process.env.NODE_ENV !== 'production' && (
        <div className="fixed bottom-4 right-4 z-[100] bg-black/80 text-white p-4 rounded-2xl text-[10px] font-mono max-w-xs pointer-events-none">
          <p className="font-bold mb-1 text-indigo-400">DEBUG INFO</p>
          <p>Groups: {groups.length}</p>
          <p>User: {user.uid.slice(0, 8)}...</p>
          {lastError && <p className="text-red-400 mt-2">Error: {lastError}</p>}
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-zinc-950/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 w-72 bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-white/5 flex flex-col z-50 lg:z-10 transition-all duration-300 ease-in-out overflow-y-auto custom-scrollbar
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Vibrant background glow */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-10 dark:opacity-20">
          <div className="absolute -top-24 -left-24 w-64 h-64 bg-indigo-600 rounded-full blur-[100px]" />
          <div className="absolute top-1/2 -right-32 w-64 h-64 bg-fuchsia-600 rounded-full blur-[100px]" />
        </div>

        <div className="p-8 relative z-10 shrink-0">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-fuchsia-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Wallet className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Budgeted</span>
            </div>
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <nav className="space-y-1.5">
            <button 
              onClick={() => {
                setSelectedGroupId(null);
                setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${!selectedGroupId ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-xl shadow-zinc-900/10 dark:shadow-white/10' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white'}`}
            >
              <LayoutDashboard className="w-5 h-5" />
              <span className="font-bold">Dashboard</span>
            </button>
          </nav>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 relative z-10 custom-scrollbar min-h-[200px]">
          <div className="flex items-center justify-between px-4 mb-4">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">Your Groups</span>
            <button 
              onClick={() => {
                setIsCreateModalOpen(true);
                setIsSidebarOpen(false);
              }}
              className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-lg transition-colors text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1">
            {groups.map(group => (
              <button
                key={group.id}
                onClick={() => {
                  setSelectedGroupId(group.id);
                  setIsSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-300 group ${selectedGroupId === group.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white'}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full transition-transform group-hover:scale-125 ${group.type === 'personal' ? 'bg-blue-400' : group.type === 'household' ? 'bg-emerald-400' : 'bg-orange-400'}`} />
                  <span className="truncate text-sm font-medium">{group.name}</span>
                </div>
                {selectedGroupId === group.id && <ChevronRight className="w-4 h-4 opacity-70" />}
              </button>
            ))}
            {groups.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-xs text-zinc-400 dark:text-zinc-600 italic">No groups yet</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-6 mt-auto relative z-10 shrink-0">
          <div className="p-4 bg-zinc-50 dark:bg-white/5 rounded-2xl border border-zinc-200 dark:border-white/10 mb-4 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} alt="" className="w-10 h-10 rounded-xl shadow-sm border border-zinc-200 dark:border-white/10" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">{user.displayName}</p>
                <p className="text-[10px] text-zinc-500 truncate font-mono">{user.email}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={logOut}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition-all duration-300 font-bold text-sm"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
            <button 
              onClick={toggleTheme}
              className="p-3 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white transition-all duration-300"
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative">
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between p-4 bg-zinc-950 border-b border-white/5 sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-fuchsia-500 rounded-lg flex items-center justify-center">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-white font-display">Budgeted</span>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 text-zinc-400 hover:text-white"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
        <AnimatePresence mode="wait">
          {!selectedGroupId ? (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="p-10 max-w-7xl mx-auto"
            >
              <Dashboard 
                user={user} 
                groups={groups} 
                onSelectGroup={(id) => {
                  setSelectedGroupId(id);
                  setIsSidebarOpen(false);
                }}
                theme={theme}
              />
            </motion.div>
          ) : (
            <motion.div
              key={selectedGroupId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="p-10 max-w-7xl mx-auto"
            >
              <GroupView 
                groupId={selectedGroupId} 
                user={user} 
                onBack={() => setSelectedGroupId(null)} 
                theme={theme}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {dataDeletedPopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setDataDeletedPopup(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[40px] shadow-2xl p-10 text-center"
            >
              <div className="w-20 h-20 bg-orange-50 dark:bg-orange-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 text-orange-600 dark:text-orange-400 border border-orange-100 dark:border-orange-500/20">
                <Settings className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-4 font-display">Demo Data Reset</h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-10 leading-relaxed text-sm">
                Your data has been deleted because 24 hours have passed since you first signed in. 
                This is a demo application. If you want your data to persist, please click the <span className="font-bold text-zinc-900 dark:text-white">Remix</span> button to create your own version of the app!
              </p>
              <button
                onClick={() => setDataDeletedPopup(false)}
                className="w-full py-4 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all shadow-lg shadow-zinc-200 dark:shadow-black/20 active:scale-95"
              >
                Got it
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <CreateGroupModal 
        isOpen={isCreateModalOpen} 
        onClose={() => setIsCreateModalOpen(false)} 
        user={user}
      />

      {/* Welcome Popup */}
      <AnimatePresence>
        {showWelcomePopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowWelcomePopup(false);
                localStorage.setItem(`hasSeenWelcome_${user.uid}`, 'true');
              }}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[40px] shadow-2xl p-10 text-center"
            >
              <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20">
                <LayoutDashboard className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-4 font-display">Welcome to the Demo!</h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-10 leading-relaxed text-sm">
                This is a demo application. To keep the demo fresh, <span className="font-bold text-zinc-900 dark:text-white">all data is automatically deleted every 24 hours</span>.
                <br /><br />
                If you want to create your own permanent version, click the <span className="font-bold text-zinc-900 dark:text-white">Remix</span> button in the top right!
              </p>
              <button
                onClick={() => {
                  setShowWelcomePopup(false);
                  localStorage.setItem(`hasSeenWelcome_${user.uid}`, 'true');
                }}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
              >
                Got it, let's go!
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
