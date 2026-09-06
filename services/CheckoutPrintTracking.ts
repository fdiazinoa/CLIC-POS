import { recordCheckoutDiagnostic, type CheckoutDiagnosticInput } from './CheckoutDiagnostics';
/** Observe the existing promise without changing completion, failure or print behavior. */
export function trackCheckoutPrint(input: CheckoutDiagnosticInput, print: () => Promise<boolean>): Promise<boolean> {
    recordCheckoutDiagnostic('PRINT_REQUEST', input);
    try {
        const result = print();
        void result.then(accepted => recordCheckoutDiagnostic('PRINT_RESULT', {...input,status:accepted ? 'ACCEPTED_BY_PRINT_PIPELINE' : 'NOT_ACCEPTED'}),
            ()=>recordCheckoutDiagnostic('PRINT_RESULT', {...input,status:'ERROR'}));
        return result;
    } catch(error) { recordCheckoutDiagnostic('PRINT_RESULT', {...input,status:'ERROR'}); throw error; }
}
