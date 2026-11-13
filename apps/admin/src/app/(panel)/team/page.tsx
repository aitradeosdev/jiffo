import type { Metadata } from 'next';
import { Badge, Card, Empty, PageHeader, tableClass, tdClass, thClass } from '@/components/ui';
import { adminRoleLabel } from '@jiffo/shared';
import { api, getCountry, getMe } from '@/lib/api';
import { ago } from '@/lib/format';
import { InviteForm, MemberActions } from './team-client';

export const metadata: Metadata = { title: 'Team' };

interface Teammate {
  id: string;
  email: string;
  name: string;
  role: string;
  status: 'invited' | 'active' | 'disabled';
  twoStep: boolean;
  inviteExpired: boolean;
  lastSignInAt: string | null;
}

export default async function TeamPage() {
  const me = await getMe();
  if (!me.permissions.includes('team')) {
    return (
      <Card>
        <Empty title="Only owners can manage the team" />
      </Card>
    );
  }
  const [team, country] = await Promise.all([api<Teammate[]>('/admin/team'), getCountry()]);

  return (
    <>
      <PageHeader title="Team" subtitle="Who can use the admin panel, and what each person can do." />
      <div className="space-y-6">
        <Card title={`${team.length} ${team.length === 1 ? 'person' : 'people'}`} padded={false}>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="border-b border-line">
                <tr>
                  <th className={thClass}>Name</th>
                  <th className={thClass}>Access</th>
                  <th className={thClass}>Last signed in</th>
                  <th className={`${thClass} text-right`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {team.map((t) => (
                  <tr key={t.id}>
                    <td className={tdClass}>
                      <div className="font-bold">
                        {t.name}
                        {t.id === me.id ? <span className="ml-1.5 font-medium text-ink-3">(you)</span> : null}
                      </div>
                      <div className="text-[13px] text-ink-3">{t.email}</div>
                    </td>
                    <td className={tdClass}>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge>{adminRoleLabel(t.role)}</Badge>
                        {t.status === 'disabled' ? <Badge tone="danger">Disabled</Badge> : null}
                        {t.status === 'invited' ? (
                          <Badge tone="warn">{t.inviteExpired ? 'Invite expired' : 'Invited'}</Badge>
                        ) : null}
                        {t.status === 'active' && !t.twoStep ? <Badge tone="warn">App not set up</Badge> : null}
                      </div>
                    </td>
                    <td className={`${tdClass} text-ink-3 whitespace-nowrap`}>
                      {t.lastSignInAt ? ago(t.lastSignInAt, country.timezone) : 'Never'}
                    </td>
                    <td className={`${tdClass} min-w-[280px]`}>
                      {t.id === me.id ? (
                        <p className="text-right text-[13px] text-ink-3">Another owner can change your access</p>
                      ) : (
                        <MemberActions member={t} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Invite someone">
          <p className="mb-4 text-[15px] text-ink-3">
            They get a link to choose a password, then set up an authenticator app at their first sign-in.
          </p>
          <InviteForm />
        </Card>
      </div>
    </>
  );
}
