import { CollaborationUser } from '@/lib/collaboration';
import { Users } from 'lucide-react';

interface PresenceIndicatorsProps {
  users: CollaborationUser[];
  currentUserId: string;
}

export default function PresenceIndicators({ users, currentUserId }: PresenceIndicatorsProps) {
  const otherUsers = users.filter((u) => u.id !== currentUserId);

  if (otherUsers.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      <Users className="w-4 h-4 text-slate-600 dark:text-slate-400" />
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {otherUsers.length} {otherUsers.length === 1 ? 'person' : 'people'} editing
      </span>
      <div className="flex gap-1 ml-2">
        {otherUsers.map((user) => (
          <div
            key={user.id}
            className="flex items-center gap-1 px-2 py-1 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600"
            title={user.name}
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: user.color }}
            />
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {user.name.split(' ')[0]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
