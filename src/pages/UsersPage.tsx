import { useState, useEffect } from 'react';
import { apiErrorText } from '@/i18n/apiErrors';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/layouts/AppLayout';
import { UserPlus, Shield, Headphones, ToggleLeft, ToggleRight, Loader2, Trash2, Package, Crown, UserCheck, Users as UsersIcon, Pencil } from 'lucide-react';
import { apiGetUsers, apiToggleUserActive, apiSetUserRoles, apiDeleteUser, apiUpdateUser } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import i18n from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import type { AppRole } from '@/contexts/AuthContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';

const ALL_ROLES: AppRole[] = ['admin', 'manager', 'pending_agent', 'prediction_agent', 'warehouse', 'ads_admin'];
const MANAGER_ALLOWED_ROLES: AppRole[] = ['pending_agent', 'prediction_agent'];

// Labels live under userRole.* in the locale files.
const roleLabel = (r: string): string => i18n.t(`userRole.${r}`, { defaultValue: r });

const ROLE_ICONS: Record<string, any> = {
  admin: Crown,
  manager: Shield,
  agent: Headphones,
  pending_agent: UserCheck,
  prediction_agent: UsersIcon,
  warehouse: Package,
  ads_admin: Shield,
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-primary/10 text-primary',
  manager: 'bg-chart-2/10 text-chart-2',
  agent: 'bg-accent text-accent-foreground',
  pending_agent: 'bg-chart-3/10 text-chart-3',
  prediction_agent: 'bg-chart-5/10 text-chart-5',
  warehouse: 'bg-chart-4/10 text-chart-4',
  ads_admin: 'bg-chart-1/10 text-chart-1',
};

interface UserRow {
  user_id: string;
  full_name: string;
  email: string;
  roles: string[];
  role: string;
  is_active: boolean;
  orders_processed: number;
  leads_processed: number;
  created_at: string;
}

export default function UsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRoles, setFormRoles] = useState<Set<string>>(new Set(['pending_agent']));
  const [formPassword, setFormPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const isAdmin = currentUser?.isAdmin ?? false;
  const isManager = currentUser?.isManager ?? false;

  // Roles this user can assign
  const availableRoles = isAdmin ? ALL_ROLES : MANAGER_ALLOWED_ROLES;

  const fetchUsers = () => {
    setLoading(true);
    apiGetUsers()
      .then((data) => {
        setUsers(data.map((u: any) => ({
          ...u,
          roles: u.roles || [u.role || 'pending_agent'],
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  const toggleFormRole = (role: string) => {
    setFormRoles(prev => {
      const next = new Set(prev);
      if (next.has(role)) {
        if (next.size > 1) next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
  };

  const handleCreateWithRoles = async () => {
    if (!formName.trim() || !formEmail.trim() || !formPassword.trim()) {
      toast({ title: t('common.error'), description: t('usersPage.allFieldsRequired'), variant: 'destructive' });
      return;
    }
    if (formRoles.size === 0) {
      toast({ title: t('common.error'), description: t('usersPage.oneRoleRequired'), variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api/users/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          full_name: formName,
          email: formEmail,
          password: formPassword,
          roles: Array.from(formRoles),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');
      toast({ title: t('usersPage.userCreated') });
      setShowModal(false);
      setFormName(''); setFormEmail(''); setFormPassword(''); setFormRoles(new Set(['pending_agent']));
      fetchUsers();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (userId: string) => {
    try {
      await apiToggleUserActive(userId);
      fetchUsers();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    }
  };

  const handleToggleRole = async (userId: string, role: string, currentRoles: string[]) => {
    const hasRole = currentRoles.includes(role);
    let newRoles: string[];
    if (hasRole) {
      newRoles = currentRoles.filter(r => r !== role);
      if (newRoles.length === 0) {
        toast({ title: t('common.error'), description: t('usersPage.mustHaveRole'), variant: 'destructive' });
        return;
      }
    } else {
      newRoles = [...currentRoles, role];
    }
    try {
      await apiSetUserRoles(userId, newRoles);
      toast({ title: t('usersPage.rolesUpdated') });
      fetchUsers();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDeleteUser(deleteTarget.user_id);
      toast({ title: t('usersPage.userDeleted') });
      setDeleteTarget(null);
      fetchUsers();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const openEdit = (u: UserRow) => {
    setEditTarget(u);
    setEditName(u.full_name);
    setEditEmail(u.email);
    setEditPassword('');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    const patch: { full_name?: string; email?: string; password?: string } = {};
    const name = editName.trim();
    const email = editEmail.trim();
    if (name && name !== editTarget.full_name) patch.full_name = name;
    if (email && email !== editTarget.email) patch.email = email;
    if (editPassword) patch.password = editPassword;
    if (Object.keys(patch).length === 0) {
      toast({ title: t('usersPage.noChanges') });
      return;
    }
    setSavingEdit(true);
    try {
      await apiUpdateUser(editTarget.user_id, patch);
      toast({ title: t('usersPage.userUpdated') });
      setEditTarget(null);
      fetchUsers();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  const isSelf = (userId: string) => currentUser?.id === userId;

  // Manager can only manage agents they can create (pending_agent, prediction_agent)
  const canManageUser = (userRoles: string[]) => {
    if (isAdmin) return true;
    if (isManager) {
      // Managers can manage pending_agent and prediction_agent users
      return userRoles.every(r => MANAGER_ALLOWED_ROLES.includes(r as AppRole));
    }
    return false;
  };

  return (
    <AppLayout title={t('nav.users')}>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('usersPage.totalUsers', { count: users.length })}</p>
        <button
          onClick={() => setShowModal(true)}
          className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="h-4 w-4" /> {t('usersPage.addUser')}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('usersPage.colUser')}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('usersPage.colRoles')}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('ordersPage.colStatus')}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('usersPage.colOrders')}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('usersPage.colLeads')}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.user_id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {u.full_name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium">{u.full_name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {isSelf(u.user_id) || !canManageUser(u.roles) ? (
                    <div className="flex flex-wrap gap-1.5">
                      {u.roles.map(r => {
                        const Icon = ROLE_ICONS[r] || Shield;
                        return (
                          <span key={r} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_COLORS[r] || 'bg-muted text-muted-foreground'}`}>
                            <Icon className="h-3 w-3" />
                            {roleLabel(r)}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {availableRoles.map(role => {
                        const hasRole = u.roles.includes(role);
                        const Icon = ROLE_ICONS[role] || Shield;
                        return (
                          <button
                            key={role}
                            onClick={() => handleToggleRole(u.user_id, role, u.roles)}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors border ${
                              hasRole
                                ? `${ROLE_COLORS[role]} border-current`
                                : 'border-border text-muted-foreground hover:bg-muted'
                            }`}
                            title={hasRole ? t('usersPage.removeRole', { role: roleLabel(role) }) : t('usersPage.addRole', { role: roleLabel(role) })}
                          >
                            <Icon className="h-3 w-3" />
                            {roleLabel(role)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => !isSelf(u.user_id) && canManageUser(u.roles) && handleToggle(u.user_id)}
                    disabled={isSelf(u.user_id) || !canManageUser(u.roles)}
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      isSelf(u.user_id) || !canManageUser(u.roles) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    } ${u.is_active ? 'text-success' : 'text-destructive'}`}
                  >
                    {u.is_active ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                    {u.is_active ? t('usersPage.active') : t('usersPage.suspended')}
                  </button>
                </td>
                <td className="px-4 py-3 font-semibold">{u.orders_processed}</td>
                <td className="px-4 py-3 font-semibold">{u.leads_processed}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {isAdmin && (
                      <button
                        onClick={() => openEdit(u)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                        title={t('usersPage.editUserTitle')}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {!isSelf(u.user_id) && canManageUser(u.roles) && (
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                        title={t('usersPage.deleteUserTitle')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      {/* Add User Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-card-foreground">{t('usersPage.createNewUser')}</h2>
            <div className="mt-4 space-y-3">
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder={t('usersPage.fullName')} className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <input value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder={t('usersPage.email')} type="email" className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">{t('usersPage.colRoles')}</label>
                <div className="flex flex-wrap gap-2">
                  {availableRoles.map(role => {
                    const isSelected = formRoles.has(role);
                    const Icon = ROLE_ICONS[role] || Shield;
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => toggleFormRole(role)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors border ${
                          isSelected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {roleLabel(role)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <input value={formPassword} onChange={e => setFormPassword(e.target.value)} placeholder={t('usersPage.password')} type="password" className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
                {t('common.cancel')}
              </button>
              <button onClick={handleCreateWithRoles} disabled={creating} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                {creating ? t('usersPage.creating') : t('usersPage.createUser')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal (Superadmin only) */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-card-foreground">{t('usersPage.editUser')}</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">{t('usersPage.fullName')}</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} placeholder={t('usersPage.fullName')} className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">{t('usersPage.email')}</label>
                <input value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder={t('usersPage.email')} type="email" className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">{t('usersPage.newPasswordOptional')}</label>
                <input value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="••••••••" type="password" autoComplete="new-password" className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setEditTarget(null)} disabled={savingEdit} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
                {t('common.cancel')}
              </button>
              <button onClick={handleSaveEdit} disabled={savingEdit} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                {savingEdit ? t('usersPage.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('usersPage.deleteUser')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('usersPage.deleteConfirm', { name: deleteTarget?.full_name, email: deleteTarget?.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? t('usersPage.deleting') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
