declare const __POS_WEBVIEW_PROFILE_BUILD__: boolean;

type NavigationMark =
  | 'SALES_TO_TABLES_INPUT'
  | 'SALES_TO_TABLES_STATE'
  | 'SALES_TO_TABLES_COMMIT'
  | 'SALES_TO_TABLES_VISIBLE'
  | 'TABLES_TO_SALES_INPUT'
  | 'TABLES_TO_SALES_STATE'
  | 'TABLES_TO_SALES_COMMIT'
  | 'TABLES_TO_SALES_VISIBLE';

/** QA-only User Timing markers; normal builds fold this branch away. */
export const markWebviewProfileNavigation = (name: NavigationMark): void => {
  if (typeof __POS_WEBVIEW_PROFILE_BUILD__ === 'undefined' || !__POS_WEBVIEW_PROFILE_BUILD__) return;
  performance.mark(name);
};
