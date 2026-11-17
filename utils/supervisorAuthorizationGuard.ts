/** Final asynchronous permission read must not outlive its requester/context.
 * Callers also check isCurrent immediately before invoking a business callback. */
export async function confirmCurrentAuthorization<T>({ isCurrent, readFinalContext, acceptsFinalContext }: {
    isCurrent: () => boolean;
    readFinalContext?: () => Promise<T>;
    acceptsFinalContext?: (context: T) => boolean;
}): Promise<boolean> {
    if (!isCurrent()) return false;
    const context = readFinalContext ? await readFinalContext() : undefined;
    return isCurrent() && (!acceptsFinalContext || acceptsFinalContext(context as T));
}
