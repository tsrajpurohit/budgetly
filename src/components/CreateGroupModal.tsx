import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Users, Home, Plane, Briefcase } from 'lucide-react';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, doc, setDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { GroupType, BudgetType } from '../types';
import { handleFirestoreError, OperationType } from '../utils/errorHandling';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

export default function CreateGroupModal({ isOpen, onClose, user }: CreateGroupModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<GroupType>('household');
  const [maxBudget, setMaxBudget] = useState('');
  const [budgetType, setBudgetType] = useState<BudgetType>('monthly');
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      // 1. Create the group
      const groupData: any = {
        name: name.trim(),
        description: description.trim(),
        type,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        memberIds: [user.uid],
      };

      if (maxBudget && !isNaN(parseFloat(maxBudget))) {
        groupData.maxBudget = parseFloat(maxBudget);
        groupData.budgetType = budgetType;
      }

      const groupRef = await addDoc(collection(db, 'groups'), groupData);
      console.log(`Group created successfully with ID: ${groupRef.id}`);

      // 2. Add the creator as an admin member
      await setDoc(doc(db, 'groups', groupRef.id, 'members', user.uid), {
        uid: user.uid,
        role: 'admin',
        joinedAt: serverTimestamp(),
        displayName: user.displayName,
        email: user.email,
      });

      onClose();
      setName('');
      setDescription('');
      setType('household');
      setMaxBudget('');
      setBudgetType('monthly');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'groups');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            aria-hidden="true"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[32px] shadow-2xl overflow-y-auto max-h-[90vh] outline-none"
            tabIndex={-1}
          >
            <div className="p-10">
              <div className="flex items-center justify-between mb-10">
                <h2 id="modal-title" className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Create New Group</h2>
                <button 
                  onClick={onClose} 
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Close modal"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-8">
                <div>
                  <label htmlFor="group-name" className="block text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-3 font-display">Group Name</label>
                  <input
                    id="group-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Summer Trip 2024, Roommates"
                    className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-medium text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                    required
                    autoFocus
                  />
                </div>

                <div>
                  <label htmlFor="group-desc" className="block text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-3 font-display">Description (Optional)</label>
                  <textarea
                    id="group-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this group for?"
                    className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all resize-none h-28 font-medium text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4 font-display">Group Type</label>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { id: 'household', label: 'Household', icon: Home, activeClass: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-400 shadow-lg shadow-emerald-500/10', iconActive: 'text-emerald-600 dark:text-emerald-400' },
                      { id: 'trip', label: 'Trip', icon: Plane, activeClass: 'bg-orange-50 dark:bg-orange-500/10 border-orange-500 text-orange-700 dark:text-orange-400 shadow-lg shadow-orange-500/10', iconActive: 'text-orange-600 dark:text-orange-400' },
                      { id: 'personal', label: 'Personal', icon: Users, activeClass: 'bg-blue-50 dark:bg-blue-500/10 border-blue-500 text-blue-700 dark:text-blue-400 shadow-lg shadow-blue-500/10', iconActive: 'text-blue-600 dark:text-emerald-400' },
                      { id: 'other', label: 'Other', icon: Briefcase, activeClass: 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500 text-indigo-700 dark:text-indigo-400 shadow-lg shadow-indigo-500/10', iconActive: 'text-indigo-600 dark:text-indigo-400' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setType(item.id as GroupType)}
                        className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all duration-300 outline-none focus:ring-2 focus:ring-indigo-500 ${
                          type === item.id
                            ? item.activeClass
                            : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-700'
                        }`}
                      >
                        <item.icon className={`w-5 h-5 ${type === item.id ? item.iconActive : 'text-zinc-400 dark:text-zinc-600'}`} />
                        <span className="font-bold text-sm">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-8 border-t border-zinc-100 dark:border-zinc-800">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-6 font-display">Budget Settings (Optional)</h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label htmlFor="max-budget" className="block text-[10px] font-bold text-zinc-500 mb-3 uppercase tracking-wider font-display">Max Budget</label>
                      <div className="relative">
                        <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-600 font-bold">₹</span>
                        <input
                          id="max-budget"
                          type="number"
                          step="0.01"
                          value={maxBudget}
                          onChange={(e) => setMaxBudget(e.target.value)}
                          placeholder="0.00"
                          className="w-full pl-10 pr-5 py-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-mono font-bold text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="budget-freq" className="block text-[10px] font-bold text-zinc-500 mb-3 uppercase tracking-wider font-display">Frequency</label>
                       <select
                        id="budget-freq"
                        value={budgetType}
                        onChange={(e) => setBudgetType(e.target.value as BudgetType)}
                        className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all appearance-none font-bold text-zinc-900 dark:text-white"
                      >
                        <option value="weekly">Per Week</option>
                        <option value="monthly">Per Month</option>
                        <option value="total">Total</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-5 bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-2xl font-bold hover:from-indigo-700 hover:to-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-4 shadow-xl shadow-indigo-500/20 active:scale-[0.98] outline-none focus:ring-4 focus:ring-indigo-500/40"
                >
                  {isSubmitting ? 'Creating...' : 'Create Group'}
                </button>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
