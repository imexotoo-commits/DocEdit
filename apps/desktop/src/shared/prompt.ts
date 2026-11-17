/** A question put to the user, drawn in Oakqueill's own style (in the page, or in a small prompt window from main). */
export interface AskOptions {
  title: string;
  /** Paragraphs separated by blank lines. */
  message?: string;
  /** Shown in a box below the message, for a path, link or file list. */
  detail?: string;
  /** The tone of the icon. */
  kind?: 'question' | 'warning' | 'danger' | 'info';
  /** The main answer; danger draws it red and puts the focus on Cancel instead. */
  confirm: { label: string; danger?: boolean };
  /** Defaults to "Cancel"; null for a message with a single button. */
  cancel?: string | null;
  /** A third answer, drawn at the left (for example "Don't save"). */
  extra?: { label: string; danger?: boolean };
  /** Put the focus on Cancel, so Enter does not say yes (for a confirmation that guards something). */
  focusCancel?: boolean;
}

export type AskAnswer = 'confirm' | 'cancel' | 'extra';
