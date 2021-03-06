import {Stats} from '../stats/stats';
import {profile} from '../profiler/decorator';
import {DEFAULT_OPERATION_MODE, DEFAULT_OVERMIND_SIGNATURE, USE_PROFILER} from '../~settings';

export enum Autonomy {
	Manual        = 0,
	SemiAutomatic = 1,
	Automatic     = 2,
}

export function getAutonomyLevel(): number {
	switch (Memory.settings.operationMode) {
		case ('manual'):
			return Autonomy.Manual;
		case ('semiautomatic'):
			return Autonomy.SemiAutomatic;
		case ('automatic'):
			return Autonomy.Automatic;
		default:
			console.log(`ERROR: ${Memory.settings.operationMode} is not a valid operation mode! ` +
						`Defaulting to ${DEFAULT_OPERATION_MODE}; use setMode() to change.`);
			Memory.settings.operationMode = DEFAULT_OPERATION_MODE;
			return getAutonomyLevel();
	}
}

let lastMemory: any;
let lastTime: number = 0;

@profile
export class Mem {

	/* Attempt to load the parsed memory from a previous tick to avoid parsing costs */
	static load() {
		if (lastTime && lastMemory && Game.time == lastTime + 1) {
			delete global.Memory;
			global.Memory = lastMemory;
			RawMemory._parsed = lastMemory;
		} else {
			// noinspection TsLint
			Memory.rooms;
			lastMemory = RawMemory._parsed;
		}
		lastTime = Game.time;
	}

	static wrap(memory: any, memName: string, defaults = {}, deep = false) {
		if (!memory[memName]) {
			memory[memName] = _.clone(defaults);
		}
		if (deep) {
			_.defaultsDeep(memory[memName], defaults);
		} else {
			_.defaults(memory[memName], defaults);
		}
		return memory[memName];
	}

	private static _setDeep(object: any, keys: string[], value: any): void {
		let key = _.first(keys);
		keys = _.drop(keys);
		if (keys.length == 0) { // at the end of the recursion
			object[key] = value;
			return;
		} else {
			if (!object[key]) {
				object[key] = {};
			}
			return Mem._setDeep(object[key], keys, value);
		}
	}

	/* Recursively set a value of an object given a dot-separated key, adding intermediate properties as necessary
	 * Ex: Mem.setDeep(Memory.colonies, 'E1S1.miningSites.siteID.stats.uptime', 0.5) */
	static setDeep(object: any, keyString: string, value: any): void {
		let keys = keyString.split('.');
		return Mem._setDeep(object, keys, value);
	}

	private static formatOvermindMemory() {
		if (!Memory.Overmind) {
			Memory.Overmind = {};
		}
		if (!Memory.colonies) {
			Memory.colonies = {};
		}
	}

	private static formatPathingMemory() {
		if (!Memory.pathing) {
			Memory.pathing = {} as PathingMemory; // Hacky workaround
		}
		_.defaults(Memory.pathing, {
			paths            : {},
			distances        : {},
			weightedDistances: {},
		});
	}

	static format() {
		// Format the memory as needed, done once every global reset
		this.formatOvermindMemory();
		this.formatPathingMemory();
		// Rest of memory formatting
		if (!Memory.settings) {
			Memory.settings = {} as any;
		}
		if (!USE_PROFILER) {
			delete Memory.profiler;
		}
		_.defaults(Memory.settings, {
			signature    : DEFAULT_OVERMIND_SIGNATURE,
			operationMode: DEFAULT_OPERATION_MODE,
			log          : {},
			enableVisuals: true,
		});
		if (!Memory.stats) {
			Memory.stats = {};
		}
		if (!Memory.stats.persistent) {
			Memory.stats.persistent = {};
		}
		if (!Memory.constructionSites) {
			Memory.constructionSites = {};
		}
		// Make global memory
		this.initGlobalMemory();
	}

	private static initGlobalMemory() {
		global._cache = <IGlobalCache>{
			accessed     : {},
			expiration   : {},
			structures   : {},
			numbers      : {},
			lists        : {},
			costMatrices : {},
			roomPositions: {},
			things       : {},
		};
	}

	private static cleanCreeps() {
		// Clear memory for non-existent creeps
		for (let name in Memory.creeps) {
			if (!Game.creeps[name]) {
				delete Memory.creeps[name];
				delete global[name];
			}
		}
	}

	private static cleanFlags() {
		// Clear memory for non-existent flags
		for (let name in Memory.flags) {
			if (!Game.flags[name]) {
				delete Memory.flags[name];
			}
		}
	}

	private static cleanColonies() {
		// Clear memory of dead colonies
		for (let name in Memory.colonies) {
			let room = Game.rooms[name];
			if (!(room && room.my)) {
				// Delete only if "persistent" is not set - use case: praise rooms
				if (!Memory.colonies[name].persistent) {
					delete Memory.colonies[name];
				}
			}
		}
	}

	private static cleanConstructionSites() {
		// Remove ancient construction sites
		if (Game.time % 10 == 0) {
			const CONSTRUCTION_SITE_TIMEOUT = 50000;
			// Add constructionSites to memory and remove really old ones
			for (let id in Game.constructionSites) {
				const site = Game.constructionSites[id];
				if (!Memory.constructionSites[id]) {
					Memory.constructionSites[id] = Game.time;
				} else if (Game.time - Memory.constructionSites[id] > CONSTRUCTION_SITE_TIMEOUT) {
					site.remove();
				}
				// Remove duplicate construction sites that get placed on top of existing structures due to caching
				if (site && site.pos.isVisible && site.pos.lookForStructure(site.structureType)) {
					site.remove();
				}
			}
			// Remove dead constructionSites from memory
			for (let id in Memory.constructionSites) {
				if (!Game.constructionSites[id]) {
					delete Memory.constructionSites[id];
				}
			}
		}
	}

	private static cleanPathingMemory() {
		const CLEAN_FREQUENCY = 5;
		if (Game.time % CLEAN_FREQUENCY == 0) {
			const distanceCleanProbability = 0.001 * CLEAN_FREQUENCY;
			const weightedDistanceCleanProbability = 0.01 * CLEAN_FREQUENCY;

			// Randomly clear some cached path lengths
			for (let pos1Name in Memory.pathing.distances) {
				if (_.isEmpty(Memory.pathing.distances[pos1Name])) {
					delete Memory.pathing.distances[pos1Name];
				} else {
					for (let pos2Name in Memory.pathing.distances[pos1Name]) {
						if (Math.random() < distanceCleanProbability) {
							delete Memory.pathing.distances[pos1Name][pos2Name];
						}
					}
				}
			}

			// Randomly clear weighted distances
			for (let pos1Name in Memory.pathing.weightedDistances) {
				if (_.isEmpty(Memory.pathing.weightedDistances[pos1Name])) {
					delete Memory.pathing.weightedDistances[pos1Name];
				} else {
					for (let pos2Name in Memory.pathing.weightedDistances[pos1Name]) {
						if (Math.random() < weightedDistanceCleanProbability) {
							delete Memory.pathing.weightedDistances[pos1Name][pos2Name];
						}
					}
				}
			}
		}
	}

	static clean() {
		// Clean the memory of non-existent objects every tick
		this.cleanCreeps();
		this.cleanFlags();
		this.cleanColonies();
		this.cleanPathingMemory();
		this.cleanConstructionSites();
		Stats.clean();
	}

}
