/**
 * Users are soft-deleted so their orders keep resolving. Spread this into any
 * `where` that must not see them.
 */
export const notDeleted = () => ({ isDeleted: false });

/**
 * Products use a `deletedAt` timestamp rather than a boolean, so they get
 * their own filter.
 */
export const notArchived = () => ({ deletedAt: null });
