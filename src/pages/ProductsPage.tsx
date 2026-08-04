import { useState, useEffect } from 'react';
import { apiErrorText } from '@/i18n/apiErrors';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/layouts/AppLayout';
import { Plus, Package, Loader2, Edit, History } from 'lucide-react';
import { apiGetProducts, apiCreateProduct, apiUpdateProduct, apiGetInventoryLogs, apiGetSuppliers } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import i18n from '@/i18n';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/EmptyState';
// Prices are STORED in EUR and the denar is derived at display time from the
// frozen MKD_PER_EUR. This screen is the one place an operator types the stored
// EUR value directly, so it shows both: the denar the customer sees, and the EUR
// actually held in the row. Showing only the raw number invites someone to
// "correct" 40.49 to 2490 and create a 153.135 ден product.
import { formatMoney, formatEurExact } from '@/lib/currency';

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  cost_price: number;
  sku: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  days_of_supply_per_unit?: number;
  is_active: boolean;
  category: string;
  supplier_id: string | null;
  suppliers?: { id: string; name: string } | null;
}

interface InventoryLog {
  id: string;
  change_amount: number;
  previous_stock: number;
  new_stock: number;
  reason: string;
  created_at: string;
}

function StockBadge({ qty, threshold }: { qty: number; threshold: number }) {
  if (qty <= 0) return <Badge variant="destructive">{i18n.t('products.outOfStock')}</Badge>;
  if (qty < threshold) return <Badge variant="destructive">{qty}</Badge>;
  if (qty === threshold) return <Badge className="bg-accent text-accent-foreground border-accent">{qty}</Badge>;
  return <Badge className="bg-primary text-primary-foreground">{qty}</Badge>;
}

export default function ProductsPage() {
  const { t } = useTranslation();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editProduct, setEditProduct] = useState<ProductRow | null>(null);
  const [logsProduct, setLogsProduct] = useState<ProductRow | null>(null);
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formCostPrice, setFormCostPrice] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formStock, setFormStock] = useState('0');
  const [formThreshold, setFormThreshold] = useState('5');
  const [formSupply, setFormSupply] = useState('15');
  const [formCategory, setFormCategory] = useState('');
  const [formSupplierId, setFormSupplierId] = useState('');
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.isAdmin || user?.isManager;
  // Cost price is sensitive — superadmins (admin role) only. Managers can edit
  // products but never see/enter cost.
  const isStrictAdmin = !!user?.isAdmin;
  // Agents' default = website retail (Selling Price) when set, else cost×3 / €15 floor.
  const suggestedSell = (cost: any, price: any) => {
    const pr = parseFloat(String(price)) || 0;
    return pr > 0 ? pr : Math.max((parseFloat(String(cost)) || 0) * 3, 15);
  };

  const fetchProducts = () => {
    setLoading(true);
    apiGetProducts()
      .then(setProducts)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProducts(); apiGetSuppliers().then(setSuppliers).catch(() => {}); }, []);

  const resetForm = () => {
    setFormName(''); setFormDesc(''); setFormPrice(''); setFormCostPrice(''); setFormSku(''); setFormStock('0'); setFormThreshold('5'); setFormSupply('15'); setFormCategory(''); setFormSupplierId('');
  };

  const handleCreate = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      await apiCreateProduct({
        name: formName, description: formDesc, price: parseFloat(formPrice) || 0,
        cost_price: parseFloat(formCostPrice) || 0,
        sku: formSku || null, stock_quantity: parseInt(formStock) || 0, low_stock_threshold: parseInt(formThreshold) || 5,
        days_of_supply_per_unit: parseInt(formSupply) || 15,
        category: formCategory, supplier_id: formSupplierId || null,
      });
      toast({ title: t('products.productCreated') });
      setShowAdd(false); resetForm(); fetchProducts();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const openEdit = (p: ProductRow) => {
    setEditProduct(p);
    setFormName(p.name); setFormDesc(p.description || ''); setFormPrice(String(p.price));
    setFormCostPrice(String(p.cost_price || 0));
    setFormSku(p.sku || ''); setFormStock(String(p.stock_quantity)); setFormThreshold(String(p.low_stock_threshold));
    setFormSupply(String(p.days_of_supply_per_unit ?? 15));
    setFormCategory(p.category || ''); setFormSupplierId(p.supplier_id || '');
  };

  const handleUpdate = async () => {
    if (!editProduct) return;
    setSaving(true);
    try {
      await apiUpdateProduct(editProduct.id, {
        name: formName, description: formDesc, price: parseFloat(formPrice) || 0,
        cost_price: parseFloat(formCostPrice) || 0,
        sku: formSku || null, stock_quantity: parseInt(formStock) || 0, low_stock_threshold: parseInt(formThreshold) || 5,
        days_of_supply_per_unit: parseInt(formSupply) || 15,
        is_active: editProduct.is_active, category: formCategory, supplier_id: formSupplierId || null,
      });
      toast({ title: t('products.productUpdated') });
      setEditProduct(null); resetForm(); fetchProducts();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const toggleActive = async (product: ProductRow) => {
    try {
      await apiUpdateProduct(product.id, { is_active: !product.is_active });
      fetchProducts();
    } catch (err: any) {
      toast({ title: t('common.error'), description: apiErrorText(err), variant: 'destructive' });
    }
  };

  const openLogs = async (p: ProductRow) => {
    setLogsProduct(p);
    setLogsLoading(true);
    try {
      const data = await apiGetInventoryLogs(p.id);
      setLogs(data);
    } catch { setLogs([]); }
    finally { setLogsLoading(false); }
  };

  const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <AppLayout title={t('nav.products')}>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('products.nProducts', { count: products.length })}</p>
        {isAdmin && (
          <button onClick={() => { resetForm(); setShowAdd(true); }} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            <Plus className="h-4 w-4" /> {t('products.addProduct')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('ordersPage.colProduct')}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('products.colSku')}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('products.colCategory')}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('products.colSupplier')}</th>
                {isStrictAdmin && <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('products.colCostPrice')}</th>}
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('products.colSellingPrice')}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('products.colStock')}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('ordersPage.colStatus')}</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {products.map(product => (
                <tr key={product.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                        <Package className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-card-foreground">{product.name}</p>
                        <p className="text-xs text-muted-foreground">{product.description || 'No description'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{product.sku || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{product.category || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{product.suppliers?.name || '—'}</td>
                  {isStrictAdmin && (
                    <td className="px-4 py-3 text-muted-foreground">
                      <div>{formatMoney(product.cost_price || 0)}</div>
                      <div className="text-[10px] opacity-60">{formatEurExact(product.cost_price || 0)}</div>
                    </td>
                  )}
                  <td className="px-4 py-3 font-semibold text-primary">
                    <div>{formatMoney(product.price)}</div>
                    <div className="text-[10px] font-normal opacity-60 text-muted-foreground">{formatEurExact(product.price)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StockBadge qty={product.stock_quantity} threshold={product.low_stock_threshold} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={product.is_active ? "default" : "secondary"}>
                      {product.is_active ? t('products.active') : t('products.disabled')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openLogs(product)} className="rounded-md p-1.5 hover:bg-muted transition-colors" title={t('products.inventoryLogs')}>
                        <History className="h-4 w-4 text-muted-foreground" />
                      </button>
                      {isAdmin && (
                        <>
                          <button onClick={() => openEdit(product)} className="rounded-md p-1.5 hover:bg-muted transition-colors" title={t('products.edit')}>
                            <Edit className="h-4 w-4 text-muted-foreground" />
                          </button>
                          <button onClick={() => toggleActive(product)} className="rounded-md p-1.5 hover:bg-muted transition-colors text-xs font-medium text-muted-foreground" title={t('products.toggleActive')}>
                            {product.is_active ? t('products.disable') : t('products.enable')}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={isStrictAdmin ? 9 : 8} className="p-0">
                    <EmptyState
                      icon={<Package className="h-5 w-5" />}
                      title={t('products.noProducts')}
                      description={t('products.noProductsDesc')}
                      size="sm"
                      className="border-0 bg-transparent hover:shadow-none"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Product Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('products.addProduct')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <input value={formName} onChange={e => setFormName(e.target.value)} placeholder={t('products.productNameReq')} className={inputClass} />
            <input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder={t('products.description')} className={inputClass} />
            <div className={`grid gap-3 ${isStrictAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {isStrictAdmin && (
                <div>
                  <label className="text-xs text-muted-foreground">{t('products.costPriceAdmin')}</label>
                  <input value={formCostPrice} onChange={e => setFormCostPrice(e.target.value)} placeholder={t('products.colCostPrice')} type="number" className={inputClass} />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatEurExact(parseFloat(formCostPrice) || 0)} = {formatMoney(parseFloat(formCostPrice) || 0)}
                  </p>
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground">{t('products.sellingPriceDesc')}</label>
                <input value={formPrice} onChange={e => setFormPrice(e.target.value)} placeholder={t('products.colSellingPrice')} type="number" className={inputClass} />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {formatEurExact(parseFloat(formPrice) || 0)} = <span className="font-medium">{formatMoney(parseFloat(formPrice) || 0)}</span>
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Agents' default: {formatMoney(suggestedSell(formCostPrice, formPrice))}{(parseFloat(formPrice) || 0) > 0 ? '' : ' (no retail set → cost×3 / €15 floor)'} · editable per order
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">{t('products.skuAuto')}</label>
                <input value={formSku} onChange={e => setFormSku(e.target.value)} placeholder={t('products.colSku')} className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('products.colCategory')}</label>
                <input value={formCategory} onChange={e => setFormCategory(e.target.value)} placeholder={t('products.colCategory')} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('products.colSupplier')}</label>
              <select value={formSupplierId} onChange={e => setFormSupplierId(e.target.value)} className={inputClass}>
                <option value="">{t('products.noSupplier')}</option>
                {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">{t('products.stockQty')}</label>
                <input value={formStock} onChange={e => setFormStock(e.target.value)} type="number" className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('products.lowStockThreshold')}</label>
                <input value={formThreshold} onChange={e => setFormThreshold(e.target.value)} type="number" className={inputClass} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('products.daysOfSupply', { defaultValue: 'Days of supply per package' })}</label>
              <input value={formSupply} onChange={e => setFormSupply(e.target.value)} type="number" className={inputClass} />
              <p className="text-[10px] text-muted-foreground mt-0.5">{t('products.daysOfSupplyHint', { defaultValue: 'Used by “Due to Reorder” recall. 15 = a 30-capsule pack; a 4-pack = 60.' })}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? t('products.creating') : t('products.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={!!editProduct} onOpenChange={open => !open && setEditProduct(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('products.editProduct')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <input value={formName} onChange={e => setFormName(e.target.value)} placeholder={t('products.productNameReq')} className={inputClass} />
            <input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder={t('products.description')} className={inputClass} />
            <div className={`grid gap-3 ${isStrictAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {isStrictAdmin && (
                <div>
                  <label className="text-xs text-muted-foreground">{t('products.costPriceAdmin')}</label>
                  <input value={formCostPrice} onChange={e => setFormCostPrice(e.target.value)} placeholder={t('products.colCostPrice')} type="number" className={inputClass} />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatEurExact(parseFloat(formCostPrice) || 0)} = {formatMoney(parseFloat(formCostPrice) || 0)}
                  </p>
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground">{t('products.sellingPriceDesc')}</label>
                <input value={formPrice} onChange={e => setFormPrice(e.target.value)} placeholder={t('products.colSellingPrice')} type="number" className={inputClass} />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {formatEurExact(parseFloat(formPrice) || 0)} = <span className="font-medium">{formatMoney(parseFloat(formPrice) || 0)}</span>
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Agents' default: {formatMoney(suggestedSell(formCostPrice, formPrice))}{(parseFloat(formPrice) || 0) > 0 ? '' : ' (no retail set → cost×3 / €15 floor)'} · editable per order
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">SKU</label>
                <input value={formSku} onChange={e => setFormSku(e.target.value)} placeholder={t('products.colSku')} className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('products.colCategory')}</label>
                <input value={formCategory} onChange={e => setFormCategory(e.target.value)} placeholder={t('products.colCategory')} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('products.colSupplier')}</label>
              <select value={formSupplierId} onChange={e => setFormSupplierId(e.target.value)} className={inputClass}>
                <option value="">{t('products.noSupplier')}</option>
                {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">{t('products.stockQty')}</label>
                <input value={formStock} onChange={e => setFormStock(e.target.value)} type="number" className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('products.lowStockThreshold')}</label>
                <input value={formThreshold} onChange={e => setFormThreshold(e.target.value)} type="number" className={inputClass} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('products.daysOfSupply', { defaultValue: 'Days of supply per package' })}</label>
              <input value={formSupply} onChange={e => setFormSupply(e.target.value)} type="number" className={inputClass} />
              <p className="text-[10px] text-muted-foreground mt-0.5">{t('products.daysOfSupplyHint', { defaultValue: 'Used by “Due to Reorder” recall. 15 = a 30-capsule pack; a 4-pack = 60.' })}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProduct(null)}>{t('common.cancel')}</Button>
            <Button onClick={handleUpdate} disabled={saving}>{saving ? t('products.savingDots') : t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inventory Logs Dialog */}
      <Dialog open={!!logsProduct} onOpenChange={open => !open && setLogsProduct(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Inventory Logs – {logsProduct?.name}</DialogTitle></DialogHeader>
          {logsLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : logs.length === 0 ? (
            <EmptyState
              icon={<History className="h-5 w-5" />}
              title={t('products.noInventoryChanges')}
              size="sm"
              className="border-0 bg-transparent"
            />
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-2">
              {logs.map(log => (
                <div key={log.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <div>
                    <span className={`font-semibold ${log.change_amount > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                      {log.change_amount > 0 ? '+' : ''}{log.change_amount}
                    </span>
                    <span className="ml-2 text-muted-foreground">{log.previous_stock} → {log.new_stock}</span>
                  </div>
                  <div className="text-right">
                    <Badge variant="secondary" className="text-xs">{log.reason}</Badge>
                    <p className="text-xs text-muted-foreground mt-0.5">{new Date(log.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
