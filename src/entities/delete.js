import { findEntityReferencesInComponents, updateReferences } from './references.js';
import { globals as api } from '../globals.js';

const USE_BACKEND_LIMIT = 500;

let evtMessenger = null;

// Gets the count of the entities and their children
function getTotalEntityCount(entities) {
    let count = 0;

    entities.forEach((entity) => {
        entity.depthFirst(() => count++);
    });

    return count;
}

// When we have a lot of entities to delete
// do it in the backend
function deleteInBackend(entities) {
    const deferred = {
        resolve: null
    };

    const promise = new Promise((resolve) => {
        deferred.resolve = resolve;
    });

    const jobId = api.jobs.start(() => {
        deferred.resolve();
    });

    if (!evtMessenger) {
        evtMessenger = api.messenger.on('entity.delete', (data) => {
            const callback = api.jobs.finish(data.job_id);
            if (callback) {
                callback();
            }
        });
    }

    api.realtime.connection.sendMessage('pipeline', {
        name: 'entities-delete',
        data: {
            projectId: api.projectId,
            branchId: api.branchId,
            sceneId: api.realtime.scenes.current.uniqueId,
            jobId: jobId,
            entities: entities.map(e => e.get('resource_id'))
        }
    });

    return promise;
}

function rememberPrevious(entities) {
    const previous = [];
    entities.forEach((entity) => {
        previous.push({
            entity: entity.jsonHierarchy(),
            index: entity.parent.get('children').indexOf(entity.get('resource_id'))
        });
    });

    // sort previous records by index so that entities
    // are added in the correct order in undo
    previous.sort((a, b) => a.index - b.index);
    return previous;
}

/**
 * Delete specified entities
 *
 * @private
 * @typedef {import("../entity").Entity} Entity
 * @param {Entity[]|Entity} entities - The entities
 * @param {object} [options] - Options
 * @param {boolean} [options.history] - Whether to record a history action. Defaults to true.
 * @param {boolean} [options.waitSubmitted] - Whether to wait till ops submitted.
 */
async function deleteEntities(entities, options = {}) {
    if (options.history === undefined) {
        options.history = true;
    }

    if (!Array.isArray(entities)) {
        entities = [entities];
    }

    // make sure we are not deleting root
    entities.forEach((e) => {
        if (e === api.entities.root) {
            throw new Error(`Cannot delete root entity ${e.get('resource_id')}`);
        }
    });

    // first only gather top level entities
    const ids = new Set();
    entities.forEach(entity => ids.add(entity.get('resource_id')));

    entities = entities.filter((entity) => {
        entity = entity.latest();
        if (!entity) return false;

        let parent = entity.parent;
        let parentInSelection = false;
        while (parent) {
            if (ids.has(parent.get('resource_id'))) {
                parentInSelection = true;
                break;
            }
            parent = parent.parent;
        }

        return !parentInSelection;
    });

    if (api.messenger &&
        api.jobs &&
        api.realtime &&
        api.realtime.scenes.current &&
        getTotalEntityCount(entities) > USE_BACKEND_LIMIT) {

        if (options.history) {
            const ok = await api.confirmFn('Deleting this many entities is not undoable. Are you sure?');
            if (ok) {
                await deleteInBackend(entities);
            }
            return;
        }
    }

    // remember previous entities
    let previous = null;
    if (options.history && api.history) {
        previous = rememberPrevious(entities);
    }

    // find entity references
    const entityReferences = findEntityReferencesInComponents(api.entities.root);

    entities.forEach((entity) => {
        api.entities.remove(entity, entityReferences);
    });

    if (previous) {
        api.history.add({
            name: 'delete entities',
            undo: () => {
                entities = previous.map((data, i) => {
                    return api.entities.create(data.entity, {
                        history: false,
                        index: data.index
                    });
                });

                entities.forEach((entity) => {
                    updateReferences(entityReferences, entity.get('resource_id'), entity.get('resource_id'));
                });

                if (api.selection) {
                    api.selection.set(entities, {
                        history: false
                    });
                }

                previous = null;
            },
            redo: () => {
                entities = entities.map(e => e.latest()).filter(e => !!e);
                previous = rememberPrevious(entities);

                api.entities.delete(entities, {
                    history: false
                });
            }
        });
    }

    if (options.waitSubmitted) {

        // wait for scene operational transforms to finish:
        // sometimes we need to execute the next operation on the backend
        // just after delete - use waitSubmitted to guarantee the order of operations
        await new Promise((resolve) => {
            if (api.realtime.scenes.current) {
                api.realtime.scenes.current.whenNothingPending(resolve);
            } else {
                resolve();
            }
        });
    }
}

export { deleteEntities };
