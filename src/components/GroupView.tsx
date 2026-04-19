import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft,
  Plus, 
  Users, 
  Receipt, 
  ArrowUpRight,
  ArrowDownLeft,
  MoreVertical, 
  Trash2, 
  UserPlus,
  TrendingUp,
  PieChart as PieChartIcon,
  Calendar,
  Tag,
  CreditCard,
  BarChart3,
  Sparkles,
  Loader2,
  Pencil,
  Download,
  Grid3X3,
  ChevronRight,
  X,
  Search,
  Image as ImageIcon,
  Paperclip,
  Eye,
  FileText,
  Camera
} from 'lucide-react';
import Markdown from 'react-markdown';
import { GoogleGenAI } from "@google/genai";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { db, storage } from '../firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  orderBy, 
  doc, 
  setDoc,
  addDoc, 
  deleteDoc, 
  serverTimestamp, 
  Timestamp,
  getDocs,
  where,
  updateDoc,
  arrayUnion,
  deleteField
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytesResumable, 
  getDownloadURL 
} from 'firebase/storage';
import { User } from 'firebase/auth';
import { Group, Expense, GroupMember, CATEGORIES, BudgetType, RecurrenceFrequency, TransactionType } from '../types';
import { formatCurrency } from '../utils/format';
import { handleFirestoreError, OperationType } from '../utils/errorHandling';

interface GroupViewProps {
  groupId: string;
  user: User;
  onBack: () => void;
  theme: 'light' | 'dark';
}

export default function GroupView({ groupId, user, onBack, theme }: GroupViewProps) {
  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Form states
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('monthly');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [transactionType, setTransactionType] = useState<TransactionType>('expense');
  const [relatedParty, setRelatedParty] = useState('');
  const [isPayorMe, setIsPayorMe] = useState(true);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  
  // Settings states
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMaxBudget, setEditMaxBudget] = useState('');
  const [editBudgetType, setEditBudgetType] = useState<BudgetType>('monthly');

  // AI Analysis states
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<{ month: number; year: number; label: string } | null>(null);
  const analysisAbortController = useRef<AbortController | null>(null);

  // Stat details modal state
  const [selectedStatDetails, setSelectedStatDetails] = useState<{ title: string; amount: number; subtitle?: string } | null>(null);
  const [selectedLedgerPerson, setSelectedLedgerPerson] = useState<string | null>(null);
  const [ledgerViewMode, setLedgerViewMode] = useState<'lent' | 'borrowed' | null>(null);
  const [isPersonDropdownOpen, setIsPersonDropdownOpen] = useState(false);
  const [expenseSearchTerm, setExpenseSearchTerm] = useState('');

  // Attachment states
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [viewingAttachmentUrl, setViewingAttachmentUrl] = useState<string | null>(null);

  const statModalRef = useRef<HTMLDivElement>(null);
  const analysisModalRef = useRef<HTMLDivElement>(null);
  const deleteGroupModalRef = useRef<HTMLDivElement>(null);
  const deleteExpenseModalRef = useRef<HTMLDivElement>(null);
  const ledgerSectionRef = useRef<HTMLDivElement>(null);

  const closeAnalysisModal = () => {
    setIsAnalysisModalOpen(false);
    if (analysisAbortController.current) {
      analysisAbortController.current.abort();
      analysisAbortController.current = null;
    }
    setIsAnalyzing(false);
    setAnalysisResult(null);
  };

  // Delete confirmation state
  const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);
  const [isDeleteGroupConfirmOpen, setIsDeleteGroupConfirmOpen] = useState(false);

  useEffect(() => {
    if (selectedStatDetails && statModalRef.current) {
      statModalRef.current.focus();
    }
  }, [selectedStatDetails]);

  useEffect(() => {
    if (isAnalysisModalOpen && analysisModalRef.current) {
      analysisModalRef.current.focus();
    }
  }, [isAnalysisModalOpen]);

  useEffect(() => {
    if (isDeleteGroupConfirmOpen && deleteGroupModalRef.current) {
      deleteGroupModalRef.current.focus();
    }
  }, [isDeleteGroupConfirmOpen]);

  useEffect(() => {
    if (expenseToDelete && deleteExpenseModalRef.current) {
      deleteExpenseModalRef.current.focus();
    }
  }, [expenseToDelete]);

  // Invite states
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  useEffect(() => {
    (window as any).openAddExpenseModal = () => {
      setEditingExpense(null);
      setIsAddExpenseOpen(true);
    };
    return () => {
      delete (window as any).openAddExpenseModal;
    };
  }, []);

  useEffect(() => {
    const groupRef = doc(db, 'groups', groupId);
    const unsubscribeGroup = onSnapshot(groupRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data() as Group;
        setGroup({ id: doc.id, ...data } as Group);
        setEditName(data.name);
        setEditDescription(data.description || '');
        setEditMaxBudget(data.maxBudget?.toString() || '');
        setEditBudgetType(data.budgetType || 'monthly');
      }
    }, (error) => {
      if (error.message.includes('Missing or insufficient permissions')) return;
      console.error("Error fetching group:", error);
    });

    const expensesQuery = query(collection(db, 'groups', groupId, 'expenses'), orderBy('date', 'desc'));
    const unsubscribeExpenses = onSnapshot(expensesQuery, (snapshot) => {
      setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense)));
    }, (error) => {
      if (error.message.includes('Missing or insufficient permissions')) return;
      console.error("Error fetching expenses:", error);
    });

    const membersQuery = collection(db, 'groups', groupId, 'members');
    const unsubscribeMembers = onSnapshot(membersQuery, (snapshot) => {
      setMembers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as GroupMember)));
    }, (error) => {
      if (error.message.includes('Missing or insufficient permissions')) return;
      console.error("Error fetching members:", error);
    });

    return () => {
      unsubscribeGroup();
      unsubscribeExpenses();
      unsubscribeMembers();
    };
  }, [groupId]);

  useEffect(() => {
    if (editingExpense) {
      setAmount(editingExpense.amount.toString());
      setDescription(editingExpense.description);
      setCategory(editingExpense.category);
      setDate(editingExpense.date.toDate().toISOString().split('T')[0]);
      setIsRecurring(editingExpense.isRecurring || false);
      setFrequency(editingExpense.frequency || 'monthly');
      setRecurrenceEndDate(editingExpense.endDate ? editingExpense.endDate.toDate().toISOString().split('T')[0] : '');
      setTransactionType(editingExpense.type || 'expense');
      setRelatedParty(editingExpense.relatedParty || (editingExpense.paidBy.startsWith('external_person_') ? editingExpense.paidBy.replace('external_person_', '') : ''));
      setIsPayorMe(editingExpense.paidBy === user.uid);
      setAttachmentPreview(editingExpense.attachmentUrl || null);
      setAttachment(null);
      setIsAddExpenseOpen(true);
    } else {
      setAmount('');
      setDescription('');
      setCategory(CATEGORIES[0]);
      setDate(new Date().toISOString().split('T')[0]);
      setIsRecurring(false);
      setFrequency('monthly');
      setRecurrenceEndDate('');
      setTransactionType('expense');
      setRelatedParty('');
      setIsPayorMe(true);
      setAttachment(null);
      setAttachmentPreview(null);
      setUploadProgress(null);
      setIsUploading(false);
    }
  }, [editingExpense]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAddExpenseOpen(false);
        setIsAddMemberOpen(false);
        setIsSettingsOpen(false);
        closeAnalysisModal();
        setIsDeleteGroupConfirmOpen(false);
        setExpenseToDelete(null);
        setEditingExpense(null);
        setSelectedStatDetails(null);
        setIsPersonDropdownOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const checkRecurringExpenses = async () => {
      if (!groupId || !user) return;
      
      try {
        const recurringQuery = query(
          collection(db, 'groups', groupId, 'expenses'),
          where('isRecurring', '==', true)
        );
        const recurringSnap = await getDocs(recurringQuery);
        const templates = recurringSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense));
        
        const now = new Date();
        now.setHours(23, 59, 59, 999);
        
        for (const template of templates) {
          const startDate = template.date.toDate();
          const frequency = template.frequency || 'monthly';
          const endDate = template.endDate?.toDate();
          
          let currentDate = new Date(startDate);
          
          // Helper to advance date
          const advanceDate = (d: Date) => {
            const next = new Date(d);
            if (frequency === 'daily') next.setDate(next.getDate() + 1);
            else if (frequency === 'weekly') next.setDate(next.getDate() + 7);
            else if (frequency === 'monthly') next.setMonth(next.getMonth() + 1);
            else if (frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
            return next;
          };

          // We skip the first date because the template is already an expense
          currentDate = advanceDate(currentDate);
          
          const limit = endDate && endDate < now ? endDate : now;

          while (currentDate <= limit) {
            // Check if this occurrence exists
            // Since firestore doesn't support inequality on multiple fields 
            // and we need to check date range for each occurrence, 
            // we'll check it one by one or fetch all for template and check locally.
            
            // To be efficient, let's fetch all expenses for this template once
            const existingQuery = query(
              collection(db, 'groups', groupId, 'expenses'),
              where('recurringTemplateId', '==', template.id)
            );
            const existingSnap = await getDocs(existingQuery);
            const existingDates = existingSnap.docs.map(d => (d.data() as Expense).date.toDate().toDateString());

            if (!existingDates.includes(currentDate.toDateString())) {
              const newExpense = {
                amount: template.amount,
                description: template.description,
                category: template.category,
                paidBy: template.paidBy,
                date: Timestamp.fromDate(new Date(currentDate)),
                createdAt: serverTimestamp(),
                splitType: template.splitType,
                recurringTemplateId: template.id
              };
              await addDoc(collection(db, 'groups', groupId, 'expenses'), newExpense);
            }
            
            currentDate = advanceDate(currentDate);
          }
        }
      } catch (error) {
        console.error("Error checking recurring expenses:", error);
      }
    };

    checkRecurringExpenses();
  }, [groupId, user]);

  const handleRemoveAttachment = () => {
    setAttachment(null);
    setAttachmentPreview(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('File size must be less than 5MB');
        return;
      }
      setAttachment(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachmentPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !description) return;

    try {
      setIsUploading(true);
      let finalAttachmentUrl = editingExpense?.attachmentUrl || null;

      // If we have a new attachment, upload it
      if (attachment) {
        const fileExt = attachment.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const storageRef = ref(storage, `attachments/${groupId}/${fileName}`);
        const uploadTask = uploadBytesResumable(storageRef, attachment);

        finalAttachmentUrl = await new Promise((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(progress);
            },
            (error) => {
              console.error("Upload error:", error);
              reject(error);
            },
            async () => {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              resolve(downloadURL);
            }
          );
        });
      } else if (!attachmentPreview) {
        // If preview was cleared, remove the URL
        finalAttachmentUrl = null;
      }

      const expenseData: any = {
        amount: parseFloat(amount),
        description: description.trim(),
        category,
        paidBy: isPayorMe ? user.uid : 'external_person_' + relatedParty.trim(),
        date: Timestamp.fromDate(new Date(date)),
        createdAt: editingExpense ? editingExpense.createdAt : serverTimestamp(),
        splitType: 'equal' as const,
        isRecurring,
        frequency: isRecurring ? frequency : null,
        endDate: isRecurring && recurrenceEndDate ? Timestamp.fromDate(new Date(recurrenceEndDate)) : null,
        type: transactionType,
        relatedParty: transactionType !== 'expense' ? relatedParty.trim() : null,
        attachmentUrl: finalAttachmentUrl
      };

      if (editingExpense) {
        await updateDoc(doc(db, 'groups', groupId, 'expenses', editingExpense.id), expenseData);
      } else {
        await addDoc(collection(db, 'groups', groupId, 'expenses'), expenseData);
      }
      
      setIsAddExpenseOpen(false);
      setEditingExpense(null);
      setAmount('');
      setDescription('');
      setIsPersonDropdownOpen(false);
      setAttachment(null);
      setAttachmentPreview(null);
      setUploadProgress(null);
      setIsUploading(false);
    } catch (error) {
      handleFirestoreError(error, editingExpense ? OperationType.UPDATE : OperationType.CREATE, `groups/${groupId}/expenses`);
      setIsUploading(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberEmail.trim() || inviteLoading) return;

    setInviteLoading(true);
    setInviteError(null);
    setInviteSuccess(false);

    try {
      // 1. Search for user by email
      const usersQuery = query(collection(db, 'users'), where('email', '==', newMemberEmail.trim()));
      const usersSnap = await getDocs(usersQuery);

      if (usersSnap.empty) {
        setInviteError('No user found with this email address. They must sign in to Budgeted at least once to be invited.');
        return;
      }

      const invitedUser = usersSnap.docs[0].data();
      const invitedUid = invitedUser.uid;

      // 2. Check if already a member
      if (group?.memberIds.includes(invitedUid)) {
        setInviteError('This user is already a member of the group.');
        return;
      }

      // 3. Add to group's memberIds array
      await updateDoc(doc(db, 'groups', groupId), {
        memberIds: arrayUnion(invitedUid)
      });

      // 4. Add to members subcollection
      await setDoc(doc(db, 'groups', groupId, 'members', invitedUid), {
        uid: invitedUid,
        role: 'member',
        joinedAt: serverTimestamp(),
        displayName: invitedUser.displayName,
        email: invitedUser.email,
        photoURL: invitedUser.photoURL || null
      });

      setInviteSuccess(true);
      setNewMemberEmail('');
      setTimeout(() => {
        setIsAddMemberOpen(false);
        setInviteSuccess(false);
      }, 2000);
    } catch (error) {
      console.error("Error adding member:", error);
      handleFirestoreError(error, OperationType.UPDATE, `groups/${groupId}/members`);
      setInviteError('Failed to add member. Please try again.');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'groups', groupId, 'expenses', id));
      setExpenseToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `groups/${groupId}/expenses/${id}`);
    }
  };

  const handleDeleteGroup = async () => {
    try {
      await deleteDoc(doc(db, 'groups', groupId));
      onBack();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `groups/${groupId}`);
    }
  };

  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;
    
    try {
      const updateData: any = {
        name: editName.trim(),
        description: editDescription.trim(),
        maxBudget: editMaxBudget ? parseFloat(editMaxBudget) : null,
        budgetType: editMaxBudget ? editBudgetType : 'total'
      };
      await updateDoc(doc(db, 'groups', groupId), updateData);
      setIsSettingsOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `groups/${groupId}`);
    }
  };

  const isDateInCurrentPeriod = (date: Date, type: BudgetType) => {
    const now = new Date();
    if (type === 'total') return true;
    
    if (type === 'monthly') {
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }
    
    if (type === 'weekly') {
      // Get start of current week (Sunday)
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);
      
      return date >= startOfWeek && date < endOfWeek;
    }
    
    return true;
  };

  const currentPeriodExpenses = expenses.filter(e => 
    isDateInCurrentPeriod(e.date.toDate(), group?.budgetType || 'total') && 
    (!e.type || e.type === 'expense')
  );

  const totalSpent = currentPeriodExpenses.reduce((sum, e) => sum + e.amount, 0);
  const userSpent = currentPeriodExpenses.filter(e => e.paidBy === user.uid).reduce((sum, e) => sum + e.amount, 0);
  const perPerson = members.length > 0 ? totalSpent / members.length : 0;
  const balance = userSpent - perPerson;

  // Budget calculation
  const currentBudgetSpent = totalSpent;

  // Loan and Debt calculations
  const lentActions = expenses.filter(e => e.type === 'lent' && e.paidBy === user.uid);
  const borrowedActions = expenses.filter(e => e.type === 'borrowed' && e.paidBy !== user.uid); // This assumes the app can track others paying. But for now let's assume simple self reports.
  
  // Simplified for self-reporting:
  // Lent: I gave money out.
  // Borrowed: I took money in.
  // Repayment (Out): I paid back what I borrowed.
  // Repayment (In): They paid back what I lent.

  const totalLent = expenses
    .filter(e => e.type === 'lent')
    .reduce((sum, e) => sum + e.amount, 0);
  
  const totalBorrowed = expenses
    .filter(e => e.type === 'borrowed')
    .reduce((sum, e) => sum + e.amount, 0);

  const totalRepaymentsIn = expenses
    .filter(e => e.type === 'repayment' && e.paidBy !== user.uid)
    .reduce((sum, e) => sum + e.amount, 0);

  const totalRepaymentsOut = expenses
    .filter(e => e.type === 'repayment' && e.paidBy === user.uid)
    .reduce((sum, e) => sum + e.amount, 0);

  const netLent = totalLent - totalRepaymentsIn;
  const netBorrowed = totalBorrowed - totalRepaymentsOut;

  // Person-wise Ledger Calculation
  const getPersonLedger = () => {
    const people = new Set<string>();
    expenses.forEach(e => {
      if (e.relatedParty) people.add(e.relatedParty);
    });

    return Array.from(people).map(name => {
      const personExpenses = expenses.filter(e => e.relatedParty === name);
      const lent = personExpenses.filter(e => e.type === 'lent').reduce((sum, e) => sum + e.amount, 0);
      const borrowed = personExpenses.filter(e => e.type === 'borrowed').reduce((sum, e) => sum + e.amount, 0);
      
      // Repayment by them (to me) - usually when e.paidBy !== user.uid for a repayment linked to a lent
      // But we simplified: repayments in are by them.
      const repaidByThem = personExpenses.filter(e => e.type === 'repayment' && e.paidBy !== user.uid).reduce((sum, e) => sum + e.amount, 0);
      
      // Repayment by me (to them)
      const repaidByMe = personExpenses.filter(e => e.type === 'repayment' && e.paidBy === user.uid).reduce((sum, e) => sum + e.amount, 0);

      const net = (lent - repaidByThem) - (borrowed - repaidByMe);
      
      return {
        name,
        lent,
        borrowed,
        repaidByThem,
        repaidByMe,
        net,
        history: personExpenses.sort((a, b) => b.date.toMillis() - a.date.toMillis())
      };
    }).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  };

  const personLedger = getPersonLedger();

  const filteredExpenses = expenses.filter(expense => {
    const searchLower = expenseSearchTerm.toLowerCase().trim();
    if (!searchLower) return true;
    
    return (
      expense.description.toLowerCase().includes(searchLower) ||
      expense.amount.toString().includes(searchLower) ||
      expense.category.toLowerCase().includes(searchLower) ||
      (expense.relatedParty && expense.relatedParty.toLowerCase().includes(searchLower))
    );
  });

  const handleOpenLedger = (mode: 'lent' | 'borrowed') => {
    setLedgerViewMode(mode);
    setTimeout(() => {
      ledgerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleDirectSettlement = (personName: string, amount: number, type: 'lent' | 'borrowed') => {
    setTransactionType('repayment');
    setRelatedParty(personName);
    setAmount(Math.abs(amount).toString());
    setDescription(`Settlement with ${personName}`);
    setIsPayorMe(type === 'borrowed');
    setIsAddExpenseOpen(true);
  };

  // Chart Data Preparation
  const getLineChartData = () => {
    if (!group || group.budgetType === 'total') return [];
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const data = [];
    
    if (group.budgetType === 'weekly') {
      const firstDayOfYear = new Date(currentYear, 0, 1);
      const startOfFirstWeek = new Date(firstDayOfYear);
      startOfFirstWeek.setDate(firstDayOfYear.getDate() - firstDayOfYear.getDay());
      startOfFirstWeek.setHours(0, 0, 0, 0);

      for (let i = 0; i < 52; i++) {
        const weekStart = new Date(startOfFirstWeek);
        weekStart.setDate(startOfFirstWeek.getDate() + (i * 7));
        
        if (weekStart > now) break;

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);

        const weekSpent = expenses
          .filter(e => {
            const ed = e.date.toDate();
            return ed >= weekStart && ed < weekEnd && ed.getFullYear() === currentYear && (!e.type || e.type === 'expense');
          })
          .reduce((sum, e) => sum + e.amount, 0);
        
        data.push({ 
          name: `W${i + 1}`, 
          amount: weekSpent 
        });
      }
    } else if (group.budgetType === 'monthly') {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      for (let i = 0; i < 12; i++) {
        if (i > now.getMonth()) break;
        
        const monthSpent = expenses
          .filter(e => {
            const ed = e.date.toDate();
            return ed.getMonth() === i && ed.getFullYear() === currentYear && (!e.type || e.type === 'expense');
          })
          .reduce((sum, e) => sum + e.amount, 0);
        data.push({ name: monthNames[i], amount: monthSpent });
      }
    }
    return data;
  };

  const getPieChartData = () => {
    const categoryMap = new Map<string, number>();
    currentPeriodExpenses.forEach(e => {
      categoryMap.set(e.category, (categoryMap.get(e.category) || 0) + e.amount);
    });
    return Array.from(categoryMap.entries()).map(([name, value]) => ({ name, value }));
  };

  const lineData = getLineChartData();
  const pieData = getPieChartData();
  const COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#71717a'];

  const getPeriodLabel = () => {
    const now = new Date();
    const type = group?.budgetType || 'total';
    
    if (type === 'monthly') {
      return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    
    if (type === 'weekly') {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      
      const startMonth = startOfWeek.toLocaleDateString('en-US', { month: 'short' });
      const endMonth = endOfWeek.toLocaleDateString('en-US', { month: 'short' });
      
      if (startMonth === endMonth) {
        return `${startMonth} ${startOfWeek.getDate()} - ${endOfWeek.getDate()}, ${now.getFullYear()}`;
      }
      return `${startMonth} ${startOfWeek.getDate()} - ${endMonth} ${endOfWeek.getDate()}, ${now.getFullYear()}`;
    }
    
    return 'All Time';
  };

  const handleAnalyzeSpending = async () => {
    setIsAnalyzing(true);
    setIsAnalysisModalOpen(true);
    setAnalysisResult(null);

    if (analysisAbortController.current) {
      analysisAbortController.current.abort();
    }
    const abortController = new AbortController();
    analysisAbortController.current = abortController;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const expenseSummary = expenses.map(e => ({
        amount: e.amount,
        description: e.description,
        category: e.category,
        date: e.date.toDate().toLocaleDateString()
      }));

      const prompt = `
        Analyze the following spending data for a group budget named "${group?.name}".
        Group Type: ${group?.type}
        Budget Type: ${group?.budgetType}
        Max Budget: ${group?.maxBudget ? `₹${group.maxBudget}` : 'No limit'}
        Total Spent in Current Period: ₹${totalSpent.toFixed(2)}
        
        Expenses:
        ${JSON.stringify(expenseSummary, null, 2)}
        
        Please provide:
        1. A summary of spending habits.
        2. Identification of any unusual or high spending categories.
        3. Practical suggestions for saving or better budget management.
        4. A brief outlook based on the current budget limit.
        
        Keep the tone helpful, professional, and encouraging. Use markdown for formatting.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ parts: [{ text: prompt }] }]
      });

      if (abortController.signal.aborted) return;

      setAnalysisResult(response.text || "Could not generate analysis.");
    } catch (error: any) {
      if (error.name === 'AbortError' || abortController.signal.aborted) {
        return;
      }
      console.error("AI Analysis Error:", error);
      setAnalysisResult("Sorry, I encountered an error while analyzing your spending. Please try again later.");
    } finally {
      if (!abortController.signal.aborted) {
        setIsAnalyzing(false);
      }
    }
  };

  const handleExportCSV = () => {
    if (!expenses.length) return;
    
    const headers = ['Date', 'Description', 'Category', 'Amount', 'Paid By', 'Recurring', 'Auto-generated'];
    const rows = expenses.map(e => [
      e.date.toDate().toLocaleDateString(),
      `"${e.description.replace(/"/g, '""')}"`,
      e.category,
      e.amount,
      members.find(m => m.uid === e.paidBy)?.displayName || 'Unknown',
      e.isRecurring ? 'Yes' : 'No',
      e.recurringTemplateId ? 'Yes' : 'No'
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${group?.name || 'expenses'}_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getHeatmapData = () => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        month: d.getMonth(),
        year: d.getFullYear(),
        label: d.toLocaleDateString('en-US', { month: 'short' })
      });
    }

    const data = CATEGORIES.map(category => {
      const monthValues = months.map(m => {
        const amount = expenses
          .filter(e => {
            const ed = e.date.toDate();
            return ed.getMonth() === m.month && 
                   ed.getFullYear() === m.year && 
                   e.category === category &&
                   (!e.type || e.type === 'expense');
          })
          .reduce((sum, e) => sum + e.amount, 0);
        return { month: m.label, amount };
      });
      return { category, monthValues };
    });

    const maxAmount = Math.max(...data.flatMap(d => d.monthValues.map(mv => mv.amount)), 1);

    return { data, months, maxAmount };
  };

  const heatmapData = getHeatmapData();

  const getDailyBreakdownData = () => {
    if (!selectedMonth) return [];
    
    const now = new Date();
    const isCurrentMonth = selectedMonth.month === now.getMonth() && selectedMonth.year === now.getFullYear();
    
    const daysInMonth = new Date(selectedMonth.year, selectedMonth.month + 1, 0).getDate();
    const limitDay = isCurrentMonth ? now.getDate() : daysInMonth;
    
    const data = [];
    
    for (let i = 1; i <= limitDay; i++) {
      const dayAmount = expenses
        .filter(e => {
          const ed = e.date.toDate();
          return ed.getDate() === i && 
                 ed.getMonth() === selectedMonth.month && 
                 ed.getFullYear() === selectedMonth.year &&
                 (!e.type || e.type === 'expense');
        })
        .reduce((sum, e) => sum + e.amount, 0);
      
      data.push({ 
        day: i, 
        amount: dayAmount 
      });
    }
    return data;
  };

  const dailyBreakdownData = getDailyBreakdownData();

  if (!group) return null;

  return (
    <div className="max-w-6xl mx-auto">
      <button 
        onClick={onBack}
        className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-300 dark:hover:border-zinc-700 rounded-xl transition-all duration-200 mb-10 group shadow-sm"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        <span className="text-sm font-bold">Back to Dashboard</span>
      </button>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-8 mb-12">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
              group.type === 'household' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20' :
              group.type === 'trip' ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-100 dark:border-orange-500/20' :
              'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-500/20'
            }`}>
              {group.type}
            </span>
            <div className="flex items-center gap-1.5 text-zinc-400 dark:text-zinc-500">
              <Calendar className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-widest">{getPeriodLabel()}</span>
            </div>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tighter text-zinc-900 dark:text-white mb-2 font-display">{group.name}</h1>
          <p className="text-zinc-600 dark:text-zinc-300 max-w-2xl leading-relaxed font-medium text-sm">{group.description || 'No description provided.'}</p>
        </div>

        <div className="flex flex-wrap items-stretch gap-2 sm:gap-3 w-full md:w-auto">
          {user.uid === group.createdBy && (
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="w-12 sm:w-auto p-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-2xl text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-all shadow-sm flex items-center justify-center shrink-0"
              title="Group Settings"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          )}
          <button 
            onClick={() => setIsAddMemberOpen(true)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-5 py-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-2xl text-sm font-bold text-zinc-700 dark:text-zinc-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-lg hover:shadow-indigo-500/10 transition-all active:scale-95"
          >
            <UserPlus className="w-4 h-4" />
            Invite
          </button>
          <button 
            onClick={handleAnalyzeSpending}
            disabled={isAnalyzing}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-5 py-3 bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-2xl text-sm font-bold hover:from-indigo-700 hover:to-violet-700 hover:shadow-xl hover:shadow-indigo-500/40 transition-all disabled:opacity-50 shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            AI Insights
          </button>
          <button 
            onClick={() => {
              setEditingExpense(null);
              setIsAddExpenseOpen(true);
            }}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-2xl text-sm font-bold text-zinc-900 dark:text-white hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-lg hover:shadow-indigo-500/10 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Add Expense
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-4 lg:gap-6 mb-12">
        <button 
          onClick={() => setSelectedStatDetails({ title: 'Total Group Spend', amount: totalSpent })}
          className="text-left w-full bg-white dark:bg-zinc-900 p-5 lg:p-6 rounded-[24px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/40 dark:shadow-zinc-950/20 relative overflow-hidden group hover:scale-[1.01] active:scale-95 transition-all cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-zinc-100 dark:bg-white/5 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-110" />
          <div className="relative">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-3 font-display">Total Group Spend</p>
            <p 
              className="text-2xl md:text-xl lg:text-2xl xl:text-3xl font-bold text-zinc-900 dark:text-white font-display tracking-tight truncate"
              title={`₹${formatCurrency(totalSpent)}`}
            >
              ₹{formatCurrency(totalSpent)}
            </p>
            {group.maxBudget && (
              <div className="mt-4">
                <div className="flex justify-between text-[9px] font-bold uppercase mb-1.5 font-display">
                  <span className="text-zinc-500">Budget</span>
                  <span className={currentBudgetSpent > group.maxBudget ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-400'}>
                    {((currentBudgetSpent / group.maxBudget) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-100 dark:bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-700 ease-out ${currentBudgetSpent > group.maxBudget ? 'bg-red-500' : 'bg-indigo-500'}`}
                    style={{ width: `${Math.min(100, (currentBudgetSpent / group.maxBudget) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </button>
        <button 
          onClick={() => setSelectedStatDetails({ title: 'Your Share', amount: perPerson, subtitle: `${totalSpent > 0 ? ((userSpent / totalSpent) * 100).toFixed(0) : 0}% of total paid by you` })}
          className="text-left w-full bg-white dark:bg-zinc-900 p-5 lg:p-6 rounded-[24px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/40 dark:shadow-black/20 relative overflow-hidden group hover:scale-[1.01] active:scale-95 transition-all cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-zinc-100 dark:bg-white/5 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-110" />
          <div className="relative">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-3 font-display">Your Share</p>
            <p 
              className="text-2xl md:text-xl lg:text-2xl xl:text-3xl font-bold text-zinc-900 dark:text-white font-display tracking-tight truncate"
              title={`₹${formatCurrency(perPerson)}`}
            >
              ₹{formatCurrency(perPerson)}
            </p>
            <p className="text-[10px] font-medium text-zinc-500 mt-3">
              {totalSpent > 0 ? ((userSpent / totalSpent) * 100).toFixed(0) : 0}% of total paid by you
            </p>
          </div>
        </button>
        <button 
          onClick={() => setSelectedStatDetails({ title: balance >= 0 ? 'You are owed' : 'You owe', amount: Math.abs(balance) })}
          className="text-left w-full bg-white dark:bg-zinc-900 p-5 lg:p-6 rounded-[24px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/40 dark:shadow-black/20 relative overflow-hidden group hover:scale-[1.01] active:scale-95 transition-all duration-300 cursor-pointer"
        >
          <div className={`absolute top-0 right-0 w-24 h-24 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-110 ${balance >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`} />
          <div className="relative">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] mb-3 text-zinc-500 font-display">
              {balance >= 0 ? 'You are owed' : 'You owe'}
            </p>
            <p 
              className={`text-2xl md:text-xl lg:text-2xl xl:text-3xl font-bold font-display tracking-tight truncate ${balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
              title={`₹${formatCurrency(Math.abs(balance))}`}
            >
              ₹{formatCurrency(Math.abs(balance))}
            </p>
          </div>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12">
        <button
          onClick={() => handleOpenLedger('lent')}
          className="bg-emerald-50/50 dark:bg-emerald-500/5 p-6 rounded-[32px] border border-emerald-100 dark:border-emerald-500/10 shadow-lg shadow-emerald-500/5 transition-all hover:bg-emerald-50 dark:hover:bg-emerald-500/10 group text-left active:scale-[0.98]"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-white dark:bg-zinc-900 rounded-xl shadow-sm">
              <ArrowUpRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-[0.2em]">Total Lent</span>
          </div>
          <p className="text-3xl font-bold text-zinc-900 dark:text-white font-display mb-1">₹{formatCurrency(totalLent)}</p>
          <div className="flex items-center justify-between mt-4 text-[10px] font-bold uppercase overflow-hidden">
            <div className="flex flex-col gap-1">
              <span className="text-zinc-500">Back: ₹{formatCurrency(totalRepaymentsIn)}</span>
              <span className="text-emerald-600">Pending: ₹{formatCurrency(netLent)}</span>
            </div>
            <div className="h-10 w-1 bg-zinc-200 dark:bg-zinc-800 rounded-full mx-4" />
            <div className="flex-1">
              <div className="flex justify-between mb-1">
                <span className="text-zinc-500">Recovery</span>
                <span className="text-emerald-600 font-mono">{totalLent > 0 ? ((totalRepaymentsIn / totalLent) * 100).toFixed(0) : 0}%</span>
              </div>
              <div className="w-full bg-zinc-200 dark:bg-white/10 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-emerald-500 h-full rounded-full transition-all duration-1000"
                  style={{ width: `${totalLent > 0 ? Math.min(100, (totalRepaymentsIn / totalLent) * 100) : 0}%` }}
                />
              </div>
            </div>
          </div>
        </button>

        <button
          onClick={() => handleOpenLedger('borrowed')}
          className="bg-amber-50/50 dark:bg-amber-500/5 p-6 rounded-[32px] border border-amber-100 dark:border-amber-500/10 shadow-lg shadow-amber-500/5 transition-all hover:bg-amber-50 dark:hover:bg-amber-500/10 group text-left active:scale-[0.98]"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-white dark:bg-zinc-900 rounded-xl shadow-sm">
              <ArrowDownLeft className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-[0.2em]">Total Borrowed</span>
          </div>
          <p className="text-3xl font-bold text-zinc-900 dark:text-white font-display mb-1">₹{formatCurrency(totalBorrowed)}</p>
          <div className="flex items-center justify-between mt-4 text-[10px] font-bold uppercase overflow-hidden">
            <div className="flex flex-col gap-1">
              <span className="text-zinc-500">Paid: ₹{formatCurrency(totalRepaymentsOut)}</span>
              <span className="text-amber-600">Owed: ₹{formatCurrency(netBorrowed)}</span>
            </div>
            <div className="h-10 w-1 bg-zinc-200 dark:bg-zinc-800 rounded-full mx-4" />
            <div className="flex-1">
              <div className="flex justify-between mb-1">
                <span className="text-zinc-500">Settled</span>
                <span className="text-amber-600 font-mono">{totalBorrowed > 0 ? ((totalRepaymentsOut / totalBorrowed) * 100).toFixed(0) : 0}%</span>
              </div>
              <div className="w-full bg-zinc-200 dark:bg-white/10 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-amber-500 h-full rounded-full transition-all duration-1000"
                  style={{ width: `${totalBorrowed > 0 ? Math.min(100, (totalRepaymentsOut / totalBorrowed) * 100) : 0}%` }}
                />
              </div>
            </div>
          </div>
        </button>
      </div>

      <AnimatePresence>
        {ledgerViewMode && (
          <motion.section 
            ref={ledgerSectionRef}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-12 overflow-hidden"
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-3 font-display">
                <Users className="w-6 h-6 text-zinc-400 dark:text-zinc-500" />
                Loans & Debts Ledger: <span className="text-indigo-600 dark:text-indigo-400 capitalize">{ledgerViewMode}</span>
              </h2>
              <button 
                onClick={() => setLedgerViewMode(null)}
                className="text-[10px] font-bold text-zinc-400 hover:text-indigo-600 uppercase tracking-widest transition-colors"
              >
                Close Ledger
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {personLedger
                .filter(p => {
                  if (ledgerViewMode === 'lent') return p.lent > 0;
                  if (ledgerViewMode === 'borrowed') return p.borrowed > 0;
                  return false;
                })
                .map(person => (
                <motion.div
                  key={person.name}
                  layout
                  className="bg-white dark:bg-zinc-900 rounded-[28px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/40 dark:shadow-black/20 overflow-hidden flex flex-col"
                >
                  <div className="p-5">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-500 font-bold font-display text-sm">
                          {person.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h4 className="font-bold text-zinc-900 dark:text-white text-sm">{person.name}</h4>
                          <p className={`text-[9px] font-bold uppercase tracking-wider ${
                            person.net > 0 ? 'text-emerald-600' : person.net < 0 ? 'text-amber-600' : 'text-zinc-400'
                          }`}>
                            {person.net > 0 ? 'Owes you' : person.net < 0 ? 'You owe' : 'Settled'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-base font-bold font-mono ${
                          person.net > 0 ? 'text-emerald-600' : person.net < 0 ? 'text-amber-600' : 'text-zinc-900 dark:text-white'
                        }`}>
                          ₹{formatCurrency(Math.abs(person.net))}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-zinc-500">Lent:</span>
                        <span className="font-bold text-zinc-700 dark:text-zinc-300">₹{formatCurrency(person.lent)}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-zinc-500">Borrowed:</span>
                        <span className="font-bold text-zinc-700 dark:text-zinc-300">₹{formatCurrency(person.borrowed)}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 mt-5">
                      <button
                        onClick={() => setSelectedLedgerPerson(selectedLedgerPerson === person.name ? null : person.name)}
                        className="py-2.5 bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-xl text-[8px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest transition-all flex items-center justify-center gap-1.5"
                      >
                        {selectedLedgerPerson === person.name ? 'Hide' : 'History'}
                        <ChevronRight className={`w-3 h-3 transition-transform duration-300 ${selectedLedgerPerson === person.name ? 'rotate-90' : ''}`} />
                      </button>
                      
                      <button
                        onClick={() => handleDirectSettlement(person.name, person.net, person.net > 0 ? 'lent' : 'borrowed')}
                        className={`py-2.5 rounded-xl text-[8px] font-bold uppercase tracking-widest transition-all shadow-lg active:scale-95 ${
                          person.net > 0 
                            ? 'bg-emerald-600 text-white shadow-emerald-500/20 hover:bg-emerald-700' 
                            : 'bg-amber-600 text-white shadow-amber-500/20 hover:bg-amber-700'
                        }`}
                      >
                        {person.net > 0 ? 'Settle In' : 'Settle Out'}
                      </button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {selectedLedgerPerson === person.name && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="bg-zinc-50/50 dark:bg-zinc-800/30 border-t border-zinc-100 dark:border-zinc-800"
                      >
                        <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                          {person.history.map(item => (
                            <div key={item.id} className="flex items-center justify-between p-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 shadow-sm transition-transform hover:scale-[1.02]">
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold ${
                                  item.type === 'lent' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10' :
                                  item.type === 'borrowed' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10' :
                                  'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10'
                                }`}>
                                  {item.type === 'lent' ? 'L' : item.type === 'borrowed' ? 'B' : 'R'}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs font-bold text-zinc-900 dark:text-white truncate">{item.description}</p>
                                    {item.attachmentUrl && (
                                      <button 
                                        onClick={() => setViewingAttachmentUrl(item.attachmentUrl!)}
                                        className="shrink-0 p-1 text-zinc-300 hover:text-indigo-500 transition-colors"
                                      >
                                        <ImageIcon className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-zinc-500 font-mono">{item.date.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                                </div>
                              </div>
                              <p className={`text-xs font-bold font-mono ${
                                item.type === 'lent' ? 'text-emerald-600' :
                                item.type === 'borrowed' ? 'text-amber-600' :
                                'text-indigo-600'
                              }`}>
                                {(item.type === 'borrowed' || (item.type === 'repayment' && item.paidBy !== user.uid)) ? '−' : '+'}₹{formatCurrency(item.amount)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        {group.budgetType !== 'total' && (
          <div className="bg-white dark:bg-zinc-900 p-4 sm:p-8 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20">
            <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-[0.15em] mb-8 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Spending Trend ({group.budgetType})
            </h3>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <LineChart data={lineData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" opacity={0.1} />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#a1a1aa', fontWeight: 500 }}
                    interval="preserveStart"
                    minTickGap={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#a1a1aa', fontWeight: 500 }}
                    tickFormatter={(value) => `₹${value}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '16px', 
                      border: 'none', 
                      boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', 
                      padding: '12px', 
                      backgroundColor: theme === 'dark' ? '#18181b' : '#ffffff', 
                      color: theme === 'dark' ? '#ffffff' : '#18181b' 
                    }}
                    itemStyle={{ fontSize: '12px', fontWeight: 600, color: theme === 'dark' ? '#ffffff' : '#18181b' }}
                    labelStyle={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 700 }}
                    formatter={(value: number) => [`₹${formatCurrency(value)}`, 'Spent']}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="amount" 
                    stroke="#4f46e5" 
                    strokeWidth={4} 
                    dot={{ r: 0 }}
                    activeDot={{ r: 6, fill: '#4f46e5', strokeWidth: 3, stroke: '#fff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        <div className={`bg-white dark:bg-zinc-900 p-4 sm:p-8 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 ${group.budgetType === 'total' ? 'lg:col-span-2' : ''}`}>
          <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-[0.15em] mb-8 flex items-center gap-2">
            <PieChartIcon className="w-4 h-4" />
            Category Distribution
          </h3>
          <div className="h-[280px] w-full">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={85}
                    paddingAngle={8}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [`₹${formatCurrency(value)}`, 'Total']}
                    contentStyle={{ 
                      borderRadius: '16px', 
                      border: 'none', 
                      boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', 
                      padding: '12px', 
                      backgroundColor: theme === 'dark' ? '#18181b' : '#ffffff', 
                      color: theme === 'dark' ? '#ffffff' : '#18181b' 
                    }}
                    itemStyle={{ color: theme === 'dark' ? '#ffffff' : '#18181b' }}
                  />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 500, paddingTop: '20px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-zinc-500 dark:text-zinc-400 text-sm">
                <PieChartIcon className="w-10 h-10 mb-2 opacity-20" />
                <p className="font-medium italic">No expenses in this period</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 p-4 sm:p-8 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 mb-12">
        <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-[0.15em] mb-8 flex items-center gap-2">
          <Grid3X3 className="w-4 h-4" />
          Monthly Breakdown Heatmap (Click a cell for details)
        </h3>
        <div className="overflow-x-auto sm:overflow-visible pb-4 custom-scrollbar">
          <div className="min-w-0 sm:min-w-0">
            <div className="grid grid-cols-[80px_repeat(6,1fr)] sm:grid-cols-[140px_repeat(6,1fr)] gap-2 sm:gap-3 mb-4">
              <div />
              {heatmapData.months.map(m => (
                <div key={`${m.month}-${m.year}`} className="text-[10px] font-bold text-zinc-400 uppercase text-center tracking-widest">
                  {m.label}
                </div>
              ))}
            </div>
            {heatmapData.data.map(row => (
              <div key={row.category} className="grid grid-cols-[80px_repeat(6,1fr)] sm:grid-cols-[140px_repeat(6,1fr)] gap-2 sm:gap-3 mb-2 sm:mb-3 items-center">
                <div className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase truncate pr-1 sm:pr-2">
                  {row.category}
                </div>
                {row.monthValues.map((mv, i) => {
                  const monthObj = heatmapData.months[i];
                  const intensity = mv.amount / heatmapData.maxAmount;
                  const isSelected = selectedMonth?.month === monthObj.month && selectedMonth?.year === monthObj.year;
                  
                  return (
                    <button 
                      key={i}
                      onClick={() => setSelectedMonth(monthObj)}
                      className={`aspect-square rounded-lg sm:rounded-xl relative group/cell transition-all duration-300 border-2 ${
                        isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-lg scale-105 z-20' : 'border-transparent'
                      }`}
                      style={{ 
                        backgroundColor: mv.amount > 0 
                          ? `rgba(79, 70, 229, ${Math.max(0.1, intensity)})` 
                          : theme === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' 
                      }}
                    >
                      <div className={`absolute inset-0 flex items-center justify-center transition-opacity rounded-lg sm:rounded-xl z-10 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover/cell:opacity-100 bg-zinc-900/80'}`}>
                        <span className={`text-[8px] sm:text-[10px] font-bold ${isSelected ? 'text-indigo-600 dark:text-indigo-400 bg-white/90 dark:bg-zinc-900/90 px-1 py-0.5 sm:px-1.5 sm:py-0.5 rounded shadow-sm' : 'text-white'}`}>₹{formatCurrency(mv.amount)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <AnimatePresence>
          {selectedMonth && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-12 pt-12 border-t border-zinc-100 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h4 className="text-xl font-bold text-zinc-900 dark:text-white font-display">
                    Daily Breakdown: {selectedMonth.label} {selectedMonth.year}
                  </h4>
                  <p className="text-sm text-zinc-500 mt-1 font-medium">Daily expense trends for the selected month</p>
                </div>
                <button 
                  onClick={() => setSelectedMonth(null)}
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>
              
              <div className="h-[300px] w-full bg-zinc-50/50 dark:bg-zinc-800/30 rounded-3xl p-6 border border-zinc-100/50 dark:border-zinc-700/30">
                {dailyBreakdownData.some(d => d.amount > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyBreakdownData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#3f3f46' : '#e4e4e7'} opacity={0.3} />
                      <XAxis 
                        dataKey="day" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: '#71717a', fontWeight: 600 }}
                        tickFormatter={(val) => `D${val}`}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: '#71717a', fontWeight: 600 }}
                        tickFormatter={(value) => `₹${value}`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '16px', 
                          border: 'none', 
                          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', 
                          padding: '12px', 
                          backgroundColor: theme === 'dark' ? '#18181b' : '#ffffff', 
                          color: theme === 'dark' ? '#ffffff' : '#18181b' 
                        }}
                        itemStyle={{ fontSize: '12px', fontWeight: 600 }}
                        labelFormatter={(day) => `Day ${day} ${selectedMonth.label}`}
                        formatter={(value: number) => [`₹${formatCurrency(value)}`, 'Spent']}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="amount" 
                        stroke="#4f46e5" 
                        strokeWidth={3} 
                        dot={{ r: 4, fill: '#4f46e5', strokeWidth: 0 }}
                        activeDot={{ r: 6, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }}
                        animationDuration={1500}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-400 opacity-50">
                    <TrendingUp className="w-12 h-12 mb-4" />
                    <p className="font-bold text-sm uppercase tracking-widest">No expenses recorded for this month</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-2.5 font-display">
              <Receipt className="w-5 h-5 text-zinc-400 dark:text-zinc-500" />
              Transaction History
            </h2>
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
              <input
                type="text"
                value={expenseSearchTerm}
                onChange={(e) => setExpenseSearchTerm(e.target.value)}
                placeholder="Search transactions..."
                className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all dark:text-white"
              />
              {expenseSearchTerm && (
                <button
                  onClick={() => setExpenseSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full text-zinc-400 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          
          <div className="bg-white dark:bg-zinc-900 rounded-[28px] border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xl shadow-zinc-200/40 dark:shadow-black/20">
            {expenses.length === 0 ? (
              <div className="p-10 sm:p-16 text-center text-sm">
                <div className="w-12 h-12 bg-zinc-50 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Receipt className="w-6 h-6 text-zinc-300 dark:text-zinc-600" />
                </div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-2">No transactions yet</h3>
                <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto text-xs">Start tracking your shared expenses by adding your first transaction.</p>
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="p-10 sm:p-16 text-center text-sm">
                <div className="w-12 h-12 bg-zinc-50 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Search className="w-6 h-6 text-zinc-300 dark:text-zinc-600" />
                </div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-2">No matches found</h3>
                <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto text-xs">We couldn't find any transactions matching "{expenseSearchTerm}".</p>
                <button 
                  onClick={() => setExpenseSearchTerm('')}
                  className="mt-4 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline uppercase tracking-wider"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredExpenses.map(expense => (
                  <div key={expense.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between group transition-all duration-200 gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 bg-zinc-50 dark:bg-zinc-800 rounded-xl flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500 border border-zinc-100 dark:border-zinc-700 group-hover:bg-white dark:group-hover:bg-zinc-800 transition-colors shrink-0">
                        <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-tighter text-zinc-500">{expense.date.toDate().toLocaleDateString('en-US', { month: 'short' })}</span>
                        <span className="text-base sm:text-lg font-bold leading-none text-zinc-900 dark:text-white">{expense.date.toDate().getDate()}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-zinc-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate text-sm sm:text-base">{expense.description}</p>
                          {expense.attachmentUrl && (
                            <button 
                              onClick={() => setViewingAttachmentUrl(expense.attachmentUrl!)}
                              className="shrink-0 p-1 text-zinc-300 hover:text-indigo-500 transition-colors"
                              title="View Receipt"
                            >
                              <ImageIcon className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                          <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-md text-[8px] sm:text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 shrink-0">{expense.category}</span>
                          {expense.type && expense.type !== 'expense' && (
                            <span className={`px-1.5 py-0.5 rounded-md text-[8px] sm:text-[9px] font-bold uppercase tracking-wider border flex items-center gap-1 shrink-0 ${
                              expense.type === 'borrowed' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-500/20' :
                              expense.type === 'lent' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/20' :
                              'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-500/20'
                            }`}>
                              {expense.type} {expense.relatedParty ? `• ${expense.relatedParty}` : ''}
                            </span>
                          )}
                          <span className="text-[9px] sm:text-[10px] text-zinc-500 dark:text-zinc-400 font-medium truncate">Paid by {members.find(m => m.uid === expense.paidBy)?.displayName || 'Unknown'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-5 w-full sm:w-auto shrink-0 mt-3 sm:mt-0 pt-2 sm:pt-0 border-t border-zinc-50 dark:border-zinc-800 sm:border-0">
                      <div className="text-left sm:text-right min-w-0">
                        <p 
                          className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white font-mono tracking-tight truncate"
                          title={`₹${formatCurrency(expense.amount)}`}
                        >
                          ₹{formatCurrency(expense.amount)}
                        </p>
                        <p className="text-[8px] sm:text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Amount</p>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button 
                          onClick={() => setEditingExpense(expense)}
                          className="p-1.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg sm:opacity-0 group-hover:opacity-100 transition-all outline-none"
                          title="Edit Expense"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => setExpenseToDelete(expense.id)}
                          className="p-1.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg sm:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all outline-none"
                          title="Delete Expense"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white mb-8 flex items-center gap-3 font-display">
            <Users className="w-6 h-6 text-zinc-400 dark:text-zinc-500" />
            Group Members
          </h2>
          <div className="bg-white dark:bg-zinc-900 p-8 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20">
            <div className="space-y-6">
              {members.map(member => (
                <div key={member.uid} className="flex items-center justify-between group">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="relative shrink-0">
                      <div className="w-12 h-12 bg-zinc-50 dark:bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-400 dark:text-zinc-500 font-bold border border-zinc-100 dark:border-zinc-700 group-hover:border-indigo-500 transition-colors">
                        {member.displayName?.charAt(0)}
                      </div>
                      {member.uid === group.createdBy && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-600 rounded-full border-2 border-white dark:border-zinc-900 flex items-center justify-center">
                          <Sparkles className="w-2 h-2 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">{member.displayName}</p>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest truncate">{member.role}</p>
                    </div>
                  </div>
                  {member.uid === group.createdBy && (
                    <span className="shrink-0 text-[9px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-100 dark:border-indigo-500/20 ml-2">OWNER</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Add Expense Modal */}
      <AnimatePresence>
        {isAddExpenseOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsAddExpenseOpen(false);
                setEditingExpense(null);
              }}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-expense-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-6 sm:p-10 outline-none"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 id="add-expense-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">
                  {editingExpense ? 'Edit Expense' : 'Add Expense'}
                </h3>
                <button 
                  type="button"
                  onClick={() => {
                    setIsAddExpenseOpen(false);
                    setEditingExpense(null);
                  }} 
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <form onSubmit={handleAddExpense} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Amount</label>
                  <div className="relative">
                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 font-mono font-bold">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full pl-10 pr-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono font-bold text-lg dark:text-white"
                      placeholder="0.00"
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Description</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white"
                    placeholder="What was it for?"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium appearance-none dark:text-white"
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Date</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Transaction Type</label>
                    <select
                      value={transactionType}
                      onChange={(e) => {
                        const val = e.target.value as TransactionType;
                        setTransactionType(val);
                        if (val === 'lent') setIsPayorMe(true);
                        if (val === 'borrowed') setIsPayorMe(false);
                      }}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium appearance-none dark:text-white"
                    >
                      <option value="expense">Normal Expense</option>
                      <option value="borrowed">Borrowed (I owe)</option>
                      <option value="lent">Lent (They owe me)</option>
                      <option value="repayment">Repayment (Settling)</option>
                    </select>
                  </div>
                  {transactionType !== 'expense' && (
                    <div className="relative">
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Person Name</label>
                      <input
                        type="text"
                        value={relatedParty}
                        onChange={(e) => {
                          setRelatedParty(e.target.value);
                          setIsPersonDropdownOpen(true);
                        }}
                        onFocus={() => setIsPersonDropdownOpen(true)}
                        className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white"
                        placeholder="Type to search or select..."
                        required
                      />
                      
                      <AnimatePresence>
                        {isPersonDropdownOpen && (
                          <>
                            <div 
                              className="fixed inset-0 z-[60]" 
                              onClick={() => setIsPersonDropdownOpen(false)}
                            />
                            <motion.div
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="absolute left-0 right-0 top-full mt-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl z-[70] max-h-48 overflow-y-auto custom-scrollbar p-2"
                            >
                              <div className="px-3 py-2 text-[8px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-700 mb-1">
                                Suggestions
                              </div>
                              {[...members.map(m => m.displayName), ...Array.from(new Set(expenses.map(e => e.relatedParty).filter(Boolean)))]
                                .filter(name => name?.toLowerCase().includes(relatedParty.toLowerCase()))
                                .slice(0, 10)
                                .map((name, idx) => (
                                  <button
                                    key={`${name}-${idx}`}
                                    type="button"
                                    onClick={() => {
                                      setRelatedParty(name || '');
                                      setIsPersonDropdownOpen(false);
                                    }}
                                    className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-200 transition-colors"
                                  >
                                    {name}
                                  </button>
                                ))}
                              {relatedParty.trim() && ![...members.map(m => m.displayName), ...Array.from(new Set(expenses.map(e => e.relatedParty).filter(Boolean)))].some(n => n?.toLowerCase() === relatedParty.toLowerCase()) && (
                                <button
                                  type="button"
                                  onClick={() => setIsPersonDropdownOpen(false)}
                                  className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 rounded-xl text-sm font-bold text-indigo-600 dark:text-indigo-400 transition-colors"
                                >
                                  Use "{relatedParty}" as new person
                                </button>
                              )}
                              {[...members.map(m => m.displayName), ...Array.from(new Set(expenses.map(e => e.relatedParty).filter(Boolean)))].length === 0 && (
                                <p className="px-4 py-3 text-xs text-zinc-500 italic">No suggestions yet</p>
                              )}
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-3">Attachment (Bill/Receipt)</label>
                  {!attachmentPreview ? (
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-2xl hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all cursor-pointer group">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <Camera className="w-8 h-8 text-zinc-300 group-hover:text-indigo-500 transition-colors mb-2" />
                        <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Click to upload bill</p>
                        <p className="text-[9px] text-zinc-400 mt-1">Images only (Max 5MB)</p>
                      </div>
                      <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                    </label>
                  ) : (
                    <div className="relative group rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 aspect-video bg-zinc-100 dark:bg-zinc-800 shadow-inner">
                      <img src={attachmentPreview} alt="Preview" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <button 
                          type="button"
                          onClick={() => setViewingAttachmentUrl(attachmentPreview)}
                          className="p-2 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/40 transition-colors shadow-lg"
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                        {!isUploading && (
                          <button 
                            type="button"
                            onClick={handleRemoveAttachment}
                            className="p-2 bg-red-500/20 backdrop-blur-md rounded-full text-red-100 hover:bg-red-500/40 transition-colors shadow-lg"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                      {isUploading && uploadProgress !== null && (
                        <div className="absolute inset-x-0 bottom-0 h-1.5 bg-zinc-900/40 backdrop-blur-sm overflow-hidden">
                          <motion.div 
                            className="h-full bg-indigo-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${uploadProgress}%` }}
                            transition={{ ease: "linear" }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {transactionType === 'repayment' && (
                  <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-2xl mb-2 mx-1">
                    <button
                      type="button"
                      onClick={() => setIsPayorMe(true)}
                      className={`flex-1 py-3 px-4 rounded-xl text-[10px] uppercase tracking-wider font-bold transition-all ${
                        isPayorMe 
                          ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-white shadow-sm' 
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      I paid back
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPayorMe(false)}
                      className={`flex-1 py-3 px-4 rounded-xl text-[10px] uppercase tracking-wider font-bold transition-all ${
                        !isPayorMe 
                          ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-white shadow-sm' 
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      They paid back
                    </button>
                  </div>
                )}

                <div className="flex flex-col gap-4 px-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="isRecurring"
                      checked={isRecurring}
                      onChange={(e) => setIsRecurring(e.target.checked)}
                      className="w-5 h-5 rounded-lg border-zinc-300 dark:border-zinc-700 text-indigo-600 focus:ring-indigo-500 transition-all cursor-pointer"
                    />
                    <label htmlFor="isRecurring" className="text-sm font-bold text-zinc-600 dark:text-zinc-300 cursor-pointer select-none">
                      Recurring Expense
                    </label>
                  </div>
                  
                  <AnimatePresence>
                    {isRecurring && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-4 pt-2 overflow-hidden"
                      >
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Frequency</label>
                            <select
                              value={frequency}
                              onChange={(e) => setFrequency(e.target.value as any)}
                              className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium appearance-none dark:text-white text-sm"
                            >
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                              <option value="monthly">Monthly</option>
                              <option value="yearly">Yearly</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">End Date (Optional)</label>
                            <input
                              type="date"
                              value={recurrenceEndDate}
                              onChange={(e) => setRecurrenceEndDate(e.target.value)}
                              className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white text-sm"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="w-full py-4 bg-zinc-900 dark:bg-indigo-600 text-white rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-indigo-700 transition-all mt-4 shadow-lg shadow-zinc-200 dark:shadow-indigo-500/20 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {uploadProgress ? `Uploading ${uploadProgress.toFixed(0)}%` : 'Processing...'}
                    </>
                  ) : (
                    editingExpense ? 'Update Transaction' : 'Save Transaction'
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Member Modal */}
      <AnimatePresence>
        {isAddMemberOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setIsAddMemberOpen(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-member-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 outline-none"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 id="add-member-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Invite Member</h3>
                <button 
                  type="button"
                  onClick={() => setIsAddMemberOpen(false)} 
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-8">Enter the email address of the person you want to add.</p>
              
              {inviteError && (
                <div className="mb-6 p-4 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 text-xs font-bold rounded-2xl">
                  {inviteError}
                </div>
              )}

              {inviteSuccess && (
                <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-2xl flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Member added successfully!
                </div>
              )}

              <form onSubmit={handleAddMember} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Email Address</label>
                  <input
                    type="email"
                    value={newMemberEmail}
                    onChange={(e) => {
                      setNewMemberEmail(e.target.value);
                      setInviteError(null);
                    }}
                    className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white"
                    placeholder="friend@example.com"
                    required
                    disabled={inviteLoading || inviteSuccess}
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={inviteLoading || inviteSuccess}
                  className="w-full py-4 bg-zinc-900 dark:bg-indigo-600 text-white rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-indigo-700 transition-all mt-4 flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-zinc-200 dark:shadow-indigo-500/20 active:scale-95"
                >
                  {inviteLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add to Group'
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 max-h-[90vh] overflow-y-auto outline-none"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 id="settings-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Group Settings</h3>
                <button 
                  type="button"
                  onClick={() => setIsSettingsOpen(false)} 
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <form onSubmit={handleUpdateSettings} className="space-y-8">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-6">General Info</h4>
                  <div className="space-y-5">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Group Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white"
                        required
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Description</label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium resize-none h-24 dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-6">Budget Limits</h4>
                  <div className="space-y-5">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Max Budget</label>
                      <div className="relative">
                        <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 font-mono font-bold">₹</span>
                        <input
                          type="number"
                          step="0.01"
                          value={editMaxBudget}
                          onChange={(e) => setEditMaxBudget(e.target.value)}
                          placeholder="No limit"
                          className="w-full pl-10 pr-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono font-bold dark:text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Frequency</label>
                      <select
                        value={editBudgetType}
                        onChange={(e) => setEditBudgetType(e.target.value as BudgetType)}
                        className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium appearance-none dark:text-white"
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
                  className="w-full py-4 bg-zinc-900 dark:bg-indigo-600 text-white rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-indigo-700 transition-all shadow-lg shadow-zinc-200 dark:shadow-indigo-500/20 active:scale-95"
                >
                  Save Settings
                </button>

                <div className="pt-8 border-t border-zinc-100 dark:border-zinc-800 space-y-4">
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="w-full py-4 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-2xl font-bold hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-all flex items-center justify-center gap-2 active:scale-95"
                  >
                    <Download className="w-5 h-5" />
                    Export Expenses (CSV)
                  </button>
                  {(members.find(m => m.uid === user.uid)?.role === 'admin' || group?.createdBy === user.uid) && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSettingsOpen(false);
                        setIsDeleteGroupConfirmOpen(true);
                      }}
                      className="w-full py-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-2xl font-bold hover:bg-red-100 dark:hover:bg-red-500/20 transition-all flex items-center justify-center gap-2 active:scale-95"
                    >
                      <Trash2 className="w-5 h-5" />
                      Delete Group
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* AI Analysis Modal */}
      <AnimatePresence>
        {isAnalysisModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={closeAnalysisModal}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              ref={analysisModalRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="analysis-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 max-h-[85vh] overflow-y-auto outline-none"
            >
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-500/10 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 id="analysis-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Spending Analysis</h3>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm">AI-powered insights for {group.name}</p>
                </div>
              </div>

              {isAnalyzing ? (
                <div className="py-16 flex flex-col items-center justify-center gap-6 text-zinc-400">
                  <div className="relative">
                    <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
                    <div className="absolute inset-0 blur-lg bg-indigo-400/20 animate-pulse" />
                  </div>
                  <p className="font-bold text-sm uppercase tracking-widest animate-pulse">Analyzing your spending habits...</p>
                </div>
              ) : (
                <div className="max-w-none">
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-[32px] p-8 border border-zinc-200 dark:border-zinc-700 analysis-content dark:text-zinc-300">
                    <Markdown>{analysisResult || ""}</Markdown>
                  </div>
                  <button
                    onClick={closeAnalysisModal}
                    className="w-full py-4 bg-zinc-900 dark:bg-indigo-600 text-white rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-indigo-700 transition-all mt-8 shadow-lg shadow-zinc-200 dark:shadow-indigo-500/20 active:scale-95"
                  >
                    Close Analysis
                  </button>
                </div>
              )}

            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Delete Group Confirmation Modal */}
      <AnimatePresence>
        {isDeleteGroupConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setIsDeleteGroupConfirmOpen(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              ref={deleteGroupModalRef}
              tabIndex={-1}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-group-title"
              aria-describedby="delete-group-desc"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 text-center outline-none"
            >
              <div className="w-20 h-20 bg-red-50 dark:bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-500/20">
                <Trash2 className="w-10 h-10" />
              </div>
              <h3 id="delete-group-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3 font-display">Delete Group?</h3>
              <p id="delete-group-desc" className="text-zinc-500 dark:text-zinc-400 text-sm mb-10 leading-relaxed">This will permanently delete the group <strong>{group?.name}</strong> and all its expenses. This action cannot be undone.</p>
              <div className="flex gap-4">
                <button
                  onClick={() => setIsDeleteGroupConfirmOpen(false)}
                  className="flex-1 py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteGroup}
                  className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 dark:shadow-red-500/20 active:scale-95"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Stat Details Modal */}
      <AnimatePresence>
        {selectedStatDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setSelectedStatDetails(null)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              ref={statModalRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="stat-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 text-center outline-none"
            >
              <p id="stat-title" className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4 font-display">{selectedStatDetails.title}</p>
              <p className="text-5xl sm:text-6xl font-bold text-zinc-900 dark:text-white font-display tracking-tight mb-2 break-all">
                ₹{formatCurrency(selectedStatDetails.amount)}
              </p>
              {selectedStatDetails.subtitle && (
                <p className="text-sm font-medium text-zinc-500 mt-4">
                  {selectedStatDetails.subtitle}
                </p>
              )}
              <button
                onClick={() => setSelectedStatDetails(null)}
                className="w-full py-4 bg-zinc-900 dark:bg-indigo-600 text-white rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-indigo-700 transition-all mt-8 shadow-lg shadow-zinc-200 dark:shadow-indigo-500/20 active:scale-95"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {expenseToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setExpenseToDelete(null)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
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
              className="relative w-full max-w-sm bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 text-center outline-none"
            >
              <div className="w-20 h-20 bg-red-50 dark:bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-500/20">
                <Trash2 className="w-10 h-10" />
              </div>
              <h3 id="delete-expense-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3 font-display">Delete Expense?</h3>
              <p id="delete-expense-desc" className="text-zinc-500 dark:text-zinc-400 text-sm mb-10 leading-relaxed">This action cannot be undone. Are you sure you want to remove this expense?</p>
              <div className="flex gap-4">
                <button
                  onClick={() => setExpenseToDelete(null)}
                  className="flex-1 py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteExpense(expenseToDelete)}
                  className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 dark:shadow-red-500/20 active:scale-95"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Full-screen Attachment Viewer */}
      <AnimatePresence>
        {viewingAttachmentUrl && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setViewingAttachmentUrl(null)}
              className="absolute inset-0 bg-black/90 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, rotate: -2 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.9, rotate: 2 }}
              className="relative max-w-4xl w-full h-full max-h-[85vh] flex flex-col"
            >
              <div className="flex justify-end p-4">
                <button 
                  onClick={() => setViewingAttachmentUrl(null)}
                  className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all hover:rotate-90"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="flex-1 min-h-0 rounded-3xl overflow-hidden shadow-2xl border border-white/10 ring-1 ring-white/20">
                <img 
                  src={viewingAttachmentUrl} 
                  alt="Attachment" 
                  className="w-full h-full object-contain bg-black"
                />
              </div>
              <div className="flex justify-center p-6 gap-4">
                <a
                  href={viewingAttachmentUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-white text-black rounded-2xl font-bold flex items-center gap-2 hover:bg-zinc-200 transition-all active:scale-95 shadow-xl"
                >
                  <Download className="w-5 h-5" />
                  Download
                </a>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
