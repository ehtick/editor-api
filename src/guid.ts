/**
 * Basically a very large random number (128-bit) which means the
 * probability of creating two that clash is vanishingly small.
 *
 * @category Internal
 */
class Guid {
    /**
     * Create an RFC4122 version 4 compliant GUID.
     *
     * @returns A new GUID.
     */
    static create() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = (c === 'x') ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

export { Guid };
