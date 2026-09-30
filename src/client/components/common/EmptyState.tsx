import { Icon, type IconName } from './Icon';

// What a list says when empty: what is missing and how to get one.
export const EmptyState = ({
  icon,
  title,
  hint,
}: {
  icon: IconName;
  title: string;
  hint: string;
}) => (
  <div className="empty-state">
    <Icon name={icon} />
    <p className="empty-state-title">{title}</p>
    <p className="empty-state-hint">{hint}</p>
  </div>
);
