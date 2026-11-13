import type { Metadata } from 'next';
import { Card } from '@/components/ui';
import { api, getCountry, getMe } from '@/lib/api';
import { CategoryRow, NewCategory, type Category } from './forms';

export const metadata: Metadata = { title: 'Categories' };

export default async function CategoriesPage() {
  const [me, country] = await Promise.all([getMe(), getCountry()]);
  const categories = await api<Category[]>(`/admin/categories?country=${country.code}`);
  const canEdit = me.permissions.includes('settings');
  return (
    <div className="space-y-6">
      <Card title={`${categories.length} categories`}>
        <p className="-mt-1 text-sm text-ink-3">
          What customers choose from when they request an errand, in this order. A hidden category stays on errands
          already made.
        </p>
        <div className="divide-y divide-line">
          {categories.map((c) => (
            <CategoryRow key={`${c.id}-${c.name}-${c.active}-${c.sort}`} category={c} canEdit={canEdit} />
          ))}
        </div>
      </Card>
      {canEdit ? (
        <Card title="Add a category">
          <NewCategory country={country.code} />
        </Card>
      ) : null}
    </div>
  );
}
