import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  Receipt, 
  ArrowRight,
  Plus,
  Wallet,
  Calendar,
  Pencil,
  Trash2,
  Loader2,
  X
} from 'lucide-react';
import { Group, Expense, BudgetType, CATEGORIES } from '../types';
import { db } from '../firebase';
import { collection, query, onSnapshot, orderBy, limit, doc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { formatCurrency } from '../utils/format';
import { handleFirestoreError, OperationType } from '../utils/errorHandling';

interface DashboardProps {
  user: User;
  groups: Group[];
  onSelectGroup: (id: string) => void;
  theme: 'light' | 'dark';
}

interface Alert {
  id: string;
  message: string;
  type: 'warning' | 'info';
  groupId: string;
}

interface DashboardExpense extends Expense {
  groupId: string;
}

export default function Dashboard({ user, groups, onSelectGroup, theme }: DashboardProps) {
  const [recentExpenses, setRecentExpenses] = useState<DashboardExpense[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isGroupsListOpen, setIsGroupsListOpen] = useState(false);
  
  // Edit/Delete states
  const [editingExpense, setEditingExpense] = useState<DashboardExpense | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<DashboardExpense | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const groupsListModalRef = React.useRef<HTMLDivElement>(null);
  const deleteExpenseModalRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isGroupsListOpen && groupsListModalRef.current) {
      groupsListModalRef.current.focus();
    }
  }, [isGroupsListOpen]);

  useEffect(() => {
    if (expenseToDelete && deleteExpenseModalRef.current) {
      deleteExpenseModalRef.current.focus();
    }
  }, [expenseToDelete]);

  // Form states for editing
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState(CATEGORIES[0]);
  const [editDate, setEditDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (editingExpense) {
      setEditAmount(editingExpense.amount.toString());
      setEditDescription(editingExpense.description);
      setEditCategory(editingExpense.category);
      setEditDate(editingExpense.date.toDate().toISOString().split('T')[0]);
    }
  }, [editingExpense]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingExpense(null);
        setExpenseToDelete(null);
        setIsGroupsListOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleUpdateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExpense) return;

    setIsSaving(true);
    try {
      const expenseRef = doc(db, 'groups', editingExpense.groupId, 'expenses', editingExpense.id);
      await updateDoc(expenseRef, {
        amount: parseFloat(editAmount),
        description: editDescription,
        category: editCategory,
        date: Timestamp.fromDate(new Date(editDate)),
      });
      setEditingExpense(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `groups/${editingExpense.groupId}/expenses/${editingExpense.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteExpense = async () => {
    if (!expenseToDelete) return;

    setIsDeleting(true);
    try {
      const expenseRef = doc(db, 'groups', expenseToDelete.groupId, 'expenses', expenseToDelete.id);
      await deleteDoc(expenseRef);
      setExpenseToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `groups/${expenseToDelete.groupId}/expenses/${expenseToDelete.id}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const isDateInCurrentPeriod = (date: Date, type: BudgetType) => {
    const now = new Date();
    if (type === 'total') return true;
    
    if (type === 'monthly') {
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }
    
    if (type === 'weekly') {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);
      
      return date >= startOfWeek && date < endOfWeek;
    }
    
    return true;
  };

  useEffect(() => {
    if (groups.length === 0) {
      setRecentExpenses([]);
      setAlerts([]);
      return;
    }

    const expensesMap = new Map<string, DashboardExpense[]>();
    
    const unsubscribes = groups.map(group => {
      const expensesQuery = query(
        collection(db, 'groups', group.id, 'expenses'),
        orderBy('date', 'desc')
      );

      return onSnapshot(expensesQuery, (snapshot) => {
        const fetchedExpenses = snapshot.docs.map(doc => ({ 
          id: doc.id, 
          groupId: group.id,
          ...doc.data() 
        } as DashboardExpense));
        
        expensesMap.set(group.id, fetchedExpenses);
        
        // Combine all expenses from all groups
        const allExpenses = Array.from(expensesMap.values()).flat();
        
        // Sort by date descending
        allExpenses.sort((a, b) => b.date.toMillis() - a.date.toMillis());
        
        // Take top 10
        setRecentExpenses(allExpenses.slice(0, 10));
        
        // Generate alerts based on budgets
        const newAlerts: Alert[] = [];
        
        groups.forEach(g => {
          if (!g.maxBudget) return;
          
          const gExpenses = expensesMap.get(g.id) || [];
          const currentPeriodExpenses = gExpenses.filter(e => 
            isDateInCurrentPeriod(e.date.toDate(), g.budgetType || 'total')
          );
          
          const totalSpent = currentPeriodExpenses.reduce((sum, e) => sum + e.amount, 0);
          
          if (totalSpent > g.maxBudget) {
            newAlerts.push({
              id: `over-budget-${g.id}`,
              message: `Group "${g.name}" is over its ${g.budgetType || 'total'} budget (₹${totalSpent.toFixed(2)} / ₹${g.maxBudget.toFixed(2)})`,
              type: 'warning' as const,
              groupId: g.id
            });
          }
        });
        
        setAlerts(newAlerts);
        
      }, (error) => {
        if (error.message.includes('Missing or insufficient permissions')) {
          // This is expected if the group was just deleted and the listener hasn't been detached yet
          return;
        }
        console.error("Error fetching expenses for group", group.id, error);
      });
    });

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [groups, user.uid]);

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3 font-display">
            Welcome back, <span className="text-indigo-600 dark:text-indigo-400">{user.displayName?.split(' ')[0]}</span>
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 font-medium text-lg">Here's what's happening with your shared budgets today.</p>
        </div>
        <button 
          onClick={() => (window as any).openCreateGroupModal?.()}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-500/40 transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
        >
          <Plus className="w-4 h-4" />
          Create New Group
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <button 
          onClick={() => {
            if (groups.length === 0) return;
            if (groups.length === 1) {
              onSelectGroup(groups[0].id);
            } else {
              setIsGroupsListOpen(true);
            }
          }}
          className={`text-left bg-indigo-600 p-8 rounded-[32px] shadow-lg shadow-indigo-500/40 relative overflow-hidden group transition-all ${groups.length > 0 ? 'hover:scale-[1.02] active:scale-95 cursor-pointer' : 'cursor-default'}`}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-6">
              <Users className="w-6 h-6 text-white" />
            </div>
            <p className="text-xs font-bold text-indigo-100 uppercase tracking-[0.2em] mb-1">Active Groups</p>
            <p className="text-4xl font-bold text-white font-display tracking-tight">{groups.length}</p>
          </div>
        </button>

        <button 
          onClick={() => {
            if (recentExpenses.length === 0) return;
            onSelectGroup(recentExpenses[0].groupId);
          }}
          className={`text-left bg-emerald-600 p-8 rounded-[32px] shadow-lg shadow-emerald-500/40 relative overflow-hidden group transition-all ${recentExpenses.length > 0 ? 'hover:scale-[1.02] active:scale-95 cursor-pointer' : 'cursor-default'}`}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-6">
              <Receipt className="w-6 h-6 text-white" />
            </div>
            <p className="text-xs font-bold text-emerald-100 uppercase tracking-[0.2em] mb-1">Recent Expenses</p>
            <p className="text-4xl font-bold text-white font-display tracking-tight">{recentExpenses.length}</p>
          </div>
        </button>

        <button 
          onClick={() => {
            if (alerts.length === 0) return;
            onSelectGroup(alerts[0].groupId);
          }}
          className={`text-left bg-fuchsia-600 p-8 rounded-[32px] shadow-lg shadow-fuchsia-500/40 relative overflow-hidden group transition-all ${alerts.length > 0 ? 'hover:scale-[1.02] active:scale-95 cursor-pointer' : 'cursor-default'}`}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-6">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <p className="text-xs font-bold text-fuchsia-100 uppercase tracking-[0.2em] mb-1">Active Alerts</p>
            <p className="text-4xl font-bold text-white font-display tracking-tight">{alerts.length}</p>
          </div>
        </button>
      </div>

      <AnimatePresence>
        {isGroupsListOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
              onClick={() => setIsGroupsListOpen(false)}
            />
            <motion.div 
              ref={groupsListModalRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="select-group-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[32px] shadow-2xl overflow-hidden outline-none"
            >
              <div className="p-8">
                <h3 id="select-group-title" className="text-xl font-bold text-zinc-900 dark:text-white mb-6 font-display">Select a Group</h3>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {groups.map(group => (
                  <button
                    key={group.id}
                    onClick={() => {
                      onSelectGroup(group.id);
                      setIsGroupsListOpen(false);
                    }}
                    className="w-full flex items-center justify-between p-4 rounded-2xl bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 border border-zinc-100 dark:border-white/5 transition-all text-left group"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${group.type === 'personal' ? 'bg-blue-400' : group.type === 'household' ? 'bg-emerald-400' : 'bg-orange-400'}`} />
                      <span className="font-bold text-zinc-900 dark:text-white">{group.name}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-zinc-400 dark:text-zinc-500 group-hover:translate-x-1 transition-transform" />
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-12">
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Recent Activity</h2>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-[32px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 overflow-hidden">
              {recentExpenses.length === 0 ? (
                <div className="p-16 text-center">
                  <div className="w-16 h-16 bg-zinc-50 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Receipt className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
                  </div>
                  <p className="text-zinc-500 dark:text-zinc-400 font-medium">No recent expenses found.</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {recentExpenses.map(expense => (
                    <div key={expense.id} className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between transition-all group hover:bg-zinc-50 dark:hover:bg-zinc-800/50 gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-12 h-12 sm:w-14 sm:h-14 bg-zinc-50 dark:bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-400 dark:text-zinc-500 transition-all border border-zinc-100 dark:border-transparent shrink-0">
                          <Receipt className="w-6 h-6 sm:w-7 sm:h-7" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-zinc-900 dark:text-white text-base sm:text-lg truncate">{expense.description}</p>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1">
                            <span className="text-[9px] sm:text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider px-2 py-0.5 sm:px-2.5 sm:py-1 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg border border-indigo-100 dark:border-indigo-500/20">{expense.category}</span>
                            <span className="text-[9px] sm:text-[10px] text-zinc-500 font-mono font-bold">
                              {expense.date.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                            <span className="text-[9px] sm:text-[10px] text-zinc-400 font-medium italic truncate max-w-[100px] sm:max-w-none">
                              in {groups.find(g => g.id === expense.groupId)?.name}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 border-t border-zinc-100 dark:border-zinc-800 sm:border-0 pt-3 sm:pt-0 shrink-0">
                        <div className="text-left sm:text-right min-w-0">
                          <p 
                            className={`text-lg sm:text-xl font-bold font-mono truncate ${expense.paidBy === user.uid ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-900 dark:text-white'}`}
                            title={`₹${formatCurrency(expense.amount)}`}
                          >
                            ₹{formatCurrency(expense.amount)}
                          </p>
                          <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-widest font-bold mt-0.5">
                            {expense.paidBy === user.uid ? 'You paid' : 'Someone paid'}
                          </p>
                        </div>
                        {expense.paidBy === user.uid && (
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => setEditingExpense(expense)}
                              className="p-2 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-xl lg:opacity-0 group-hover:opacity-100 focus:opacity-100 focus:bg-indigo-50 dark:focus:bg-indigo-500/10 transition-all active:scale-90 outline-none focus:ring-2 focus:ring-indigo-500"
                              title="Edit Expense"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => setExpenseToDelete(expense)}
                              className="p-2 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl lg:opacity-0 group-hover:opacity-100 focus:opacity-100 focus:bg-red-50 dark:focus:bg-red-500/10 transition-all active:scale-90 outline-none focus:ring-2 focus:ring-red-500"
                              title="Delete Expense"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-12">
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Budget Alerts</h2>
            </div>
            <div className="space-y-4">
              {alerts.length === 0 ? (
                <div className="p-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[32px] text-center shadow-xl shadow-zinc-200/50 dark:shadow-black/20">
                  <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
                    <TrendingDown className="w-6 h-6 text-emerald-500" />
                  </div>
                  <p className="text-zinc-500 text-sm font-medium">All budgets on track</p>
                </div>
              ) : (
                alerts.map(alert => (
                  <motion.div 
                    key={alert.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-6 rounded-[32px] border shadow-md transition-all duration-300 ${
                      alert.type === 'warning' 
                        ? 'bg-red-50 dark:bg-red-950/80 border-red-200 dark:border-red-900/50 text-red-900 dark:text-red-100 backdrop-blur-sm' 
                        : 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                    }`}
                  >
                    <div className="flex gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        alert.type === 'warning' ? 'bg-red-500/10 dark:bg-red-500/20' : 'bg-white/20'
                      }`}>
                        <TrendingUp className={`w-5 h-5 ${alert.type === 'warning' ? 'text-red-600 dark:text-red-400' : 'text-white'}`} />
                      </div>
                      <p className="text-sm font-bold leading-relaxed">{alert.message}</p>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {editingExpense && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setEditingExpense(null)}
              className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-expense-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 outline-none"
              tabIndex={-1}
            >
              <div className="flex items-center justify-between mb-8">
                <h3 id="edit-expense-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Edit Expense</h3>
                <button 
                  onClick={() => setEditingExpense(null)} 
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              
              <form onSubmit={handleUpdateExpense} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Amount</label>
                  <div className="relative">
                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 font-mono font-bold">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className="w-full pl-10 pr-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono font-bold dark:text-white"
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Description</label>
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white"
                    placeholder="What was this for?"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Category</label>
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium appearance-none dark:text-white"
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Date</label>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white"
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all mt-4 flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-indigo-500/20 active:scale-95"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Changes'}
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {expenseToDelete && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setExpenseToDelete(null)}
              className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
            />
            <motion.div
              ref={deleteExpenseModalRef}
              tabIndex={-1}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-expense-title"
              aria-describedby="delete-expense-desc"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 text-center outline-none"
            >
              <div className="w-20 h-20 bg-red-50 dark:bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 text-red-600 border border-red-100 dark:border-red-500/20">
                <Trash2 className="w-10 h-10" />
              </div>
              <h3 id="delete-expense-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-4 font-display">Delete Expense?</h3>
              <p id="delete-expense-desc" className="text-zinc-500 dark:text-zinc-400 mb-10 leading-relaxed">
                Are you sure you want to delete this expense? This action cannot be undone.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => setExpenseToDelete(null)}
                  className="flex-1 py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteExpense}
                  disabled={isDeleting}
                  className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-red-500/20 active:scale-95"
                >
                  {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
