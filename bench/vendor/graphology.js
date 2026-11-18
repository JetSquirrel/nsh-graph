var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// node_modules/graphology-utils/is-graph.js
var require_is_graph = __commonJS(function(exports, module) {
  module.exports = function isGraph(value) {
    return value !== null && typeof value === "object" && typeof value.addUndirectedEdgeWithKey === "function" && typeof value.dropNode === "function" && typeof value.multi === "boolean";
  };
});

// node_modules/graphology-utils/getters.js
var require_getters = __commonJS(function(exports) {
  function coerceWeight(value) {
    if (typeof value !== "number" || isNaN(value))
      return 1;
    return value;
  }
  function createNodeValueGetter(nameOrFunction, defaultValue) {
    var getter = {};
    var coerceToDefault = function(v) {
      if (typeof v === "undefined")
        return defaultValue;
      return v;
    };
    if (typeof defaultValue === "function")
      coerceToDefault = defaultValue;
    var get = function(attributes) {
      return coerceToDefault(attributes[nameOrFunction]);
    };
    var returnDefault = function() {
      return coerceToDefault(undefined);
    };
    if (typeof nameOrFunction === "string") {
      getter.fromAttributes = get;
      getter.fromGraph = function(graph, node) {
        return get(graph.getNodeAttributes(node));
      };
      getter.fromEntry = function(node, attributes) {
        return get(attributes);
      };
    } else if (typeof nameOrFunction === "function") {
      getter.fromAttributes = function() {
        throw new Error("graphology-utils/getters/createNodeValueGetter: irrelevant usage.");
      };
      getter.fromGraph = function(graph, node) {
        return coerceToDefault(nameOrFunction(node, graph.getNodeAttributes(node)));
      };
      getter.fromEntry = function(node, attributes) {
        return coerceToDefault(nameOrFunction(node, attributes));
      };
    } else {
      getter.fromAttributes = returnDefault;
      getter.fromGraph = returnDefault;
      getter.fromEntry = returnDefault;
    }
    return getter;
  }
  function createEdgeValueGetter(nameOrFunction, defaultValue) {
    var getter = {};
    var coerceToDefault = function(v) {
      if (typeof v === "undefined")
        return defaultValue;
      return v;
    };
    if (typeof defaultValue === "function")
      coerceToDefault = defaultValue;
    var get = function(attributes) {
      return coerceToDefault(attributes[nameOrFunction]);
    };
    var returnDefault = function() {
      return coerceToDefault(undefined);
    };
    if (typeof nameOrFunction === "string") {
      getter.fromAttributes = get;
      getter.fromGraph = function(graph, edge) {
        return get(graph.getEdgeAttributes(edge));
      };
      getter.fromEntry = function(edge, attributes) {
        return get(attributes);
      };
      getter.fromPartialEntry = getter.fromEntry;
      getter.fromMinimalEntry = getter.fromEntry;
    } else if (typeof nameOrFunction === "function") {
      getter.fromAttributes = function() {
        throw new Error("graphology-utils/getters/createEdgeValueGetter: irrelevant usage.");
      };
      getter.fromGraph = function(graph, edge) {
        var extremities = graph.extremities(edge);
        return coerceToDefault(nameOrFunction(edge, graph.getEdgeAttributes(edge), extremities[0], extremities[1], graph.getNodeAttributes(extremities[0]), graph.getNodeAttributes(extremities[1]), graph.isUndirected(edge)));
      };
      getter.fromEntry = function(e, a, s, t, sa, ta, u) {
        return coerceToDefault(nameOrFunction(e, a, s, t, sa, ta, u));
      };
      getter.fromPartialEntry = function(e, a, s, t) {
        return coerceToDefault(nameOrFunction(e, a, s, t));
      };
      getter.fromMinimalEntry = function(e, a) {
        return coerceToDefault(nameOrFunction(e, a));
      };
    } else {
      getter.fromAttributes = returnDefault;
      getter.fromGraph = returnDefault;
      getter.fromEntry = returnDefault;
      getter.fromMinimalEntry = returnDefault;
    }
    return getter;
  }
  exports.createNodeValueGetter = createNodeValueGetter;
  exports.createEdgeValueGetter = createEdgeValueGetter;
  exports.createEdgeWeightGetter = function(name) {
    return createEdgeValueGetter(name, coerceWeight);
  };
});

// node_modules/graphology-layout-forceatlas2/iterate.js
var require_iterate = __commonJS(function(exports, module) {
  var NODE_X = 0;
  var NODE_Y = 1;
  var NODE_DX = 2;
  var NODE_DY = 3;
  var NODE_OLD_DX = 4;
  var NODE_OLD_DY = 5;
  var NODE_MASS = 6;
  var NODE_CONVERGENCE = 7;
  var NODE_SIZE = 8;
  var NODE_FIXED = 9;
  var EDGE_SOURCE = 0;
  var EDGE_TARGET = 1;
  var EDGE_WEIGHT = 2;
  var REGION_NODE = 0;
  var REGION_CENTER_X = 1;
  var REGION_CENTER_Y = 2;
  var REGION_SIZE = 3;
  var REGION_NEXT_SIBLING = 4;
  var REGION_FIRST_CHILD = 5;
  var REGION_MASS = 6;
  var REGION_MASS_CENTER_X = 7;
  var REGION_MASS_CENTER_Y = 8;
  var SUBDIVISION_ATTEMPTS = 3;
  var PPN = 10;
  var PPE = 3;
  var PPR = 9;
  var MAX_FORCE = 10;
  module.exports = function iterate(options, NodeMatrix, EdgeMatrix) {
    var l, r, n, n1, n2, rn, e, w, g, s;
    var order = NodeMatrix.length, size = EdgeMatrix.length;
    var adjustSizes = options.adjustSizes;
    var thetaSquared = options.barnesHutTheta * options.barnesHutTheta;
    var outboundAttCompensation, coefficient, xDist, yDist, ewc, distance, factor;
    var RegionMatrix = [];
    for (n = 0;n < order; n += PPN) {
      NodeMatrix[n + NODE_OLD_DX] = NodeMatrix[n + NODE_DX];
      NodeMatrix[n + NODE_OLD_DY] = NodeMatrix[n + NODE_DY];
      NodeMatrix[n + NODE_DX] = 0;
      NodeMatrix[n + NODE_DY] = 0;
    }
    if (options.outboundAttractionDistribution) {
      outboundAttCompensation = 0;
      for (n = 0;n < order; n += PPN) {
        outboundAttCompensation += NodeMatrix[n + NODE_MASS];
      }
      outboundAttCompensation /= order / PPN;
    }
    if (options.barnesHutOptimize) {
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, q, q2, subdivisionAttempts;
      for (n = 0;n < order; n += PPN) {
        minX = Math.min(minX, NodeMatrix[n + NODE_X]);
        maxX = Math.max(maxX, NodeMatrix[n + NODE_X]);
        minY = Math.min(minY, NodeMatrix[n + NODE_Y]);
        maxY = Math.max(maxY, NodeMatrix[n + NODE_Y]);
      }
      var dx = maxX - minX, dy = maxY - minY;
      if (dx > dy) {
        minY -= (dx - dy) / 2;
        maxY = minY + dx;
      } else {
        minX -= (dy - dx) / 2;
        maxX = minX + dy;
      }
      RegionMatrix[0 + REGION_NODE] = -1;
      RegionMatrix[0 + REGION_CENTER_X] = (minX + maxX) / 2;
      RegionMatrix[0 + REGION_CENTER_Y] = (minY + maxY) / 2;
      RegionMatrix[0 + REGION_SIZE] = Math.max(maxX - minX, maxY - minY);
      RegionMatrix[0 + REGION_NEXT_SIBLING] = -1;
      RegionMatrix[0 + REGION_FIRST_CHILD] = -1;
      RegionMatrix[0 + REGION_MASS] = 0;
      RegionMatrix[0 + REGION_MASS_CENTER_X] = 0;
      RegionMatrix[0 + REGION_MASS_CENTER_Y] = 0;
      l = 1;
      for (n = 0;n < order; n += PPN) {
        r = 0;
        subdivisionAttempts = SUBDIVISION_ATTEMPTS;
        while (true) {
          if (RegionMatrix[r + REGION_FIRST_CHILD] >= 0) {
            if (NodeMatrix[n + NODE_X] < RegionMatrix[r + REGION_CENTER_X]) {
              if (NodeMatrix[n + NODE_Y] < RegionMatrix[r + REGION_CENTER_Y]) {
                q = RegionMatrix[r + REGION_FIRST_CHILD];
              } else {
                q = RegionMatrix[r + REGION_FIRST_CHILD] + PPR;
              }
            } else {
              if (NodeMatrix[n + NODE_Y] < RegionMatrix[r + REGION_CENTER_Y]) {
                q = RegionMatrix[r + REGION_FIRST_CHILD] + PPR * 2;
              } else {
                q = RegionMatrix[r + REGION_FIRST_CHILD] + PPR * 3;
              }
            }
            RegionMatrix[r + REGION_MASS_CENTER_X] = (RegionMatrix[r + REGION_MASS_CENTER_X] * RegionMatrix[r + REGION_MASS] + NodeMatrix[n + NODE_X] * NodeMatrix[n + NODE_MASS]) / (RegionMatrix[r + REGION_MASS] + NodeMatrix[n + NODE_MASS]);
            RegionMatrix[r + REGION_MASS_CENTER_Y] = (RegionMatrix[r + REGION_MASS_CENTER_Y] * RegionMatrix[r + REGION_MASS] + NodeMatrix[n + NODE_Y] * NodeMatrix[n + NODE_MASS]) / (RegionMatrix[r + REGION_MASS] + NodeMatrix[n + NODE_MASS]);
            RegionMatrix[r + REGION_MASS] += NodeMatrix[n + NODE_MASS];
            r = q;
            continue;
          } else {
            if (RegionMatrix[r + REGION_NODE] < 0) {
              RegionMatrix[r + REGION_NODE] = n;
              break;
            } else {
              RegionMatrix[r + REGION_FIRST_CHILD] = l * PPR;
              w = RegionMatrix[r + REGION_SIZE] / 2;
              g = RegionMatrix[r + REGION_FIRST_CHILD];
              RegionMatrix[g + REGION_NODE] = -1;
              RegionMatrix[g + REGION_CENTER_X] = RegionMatrix[r + REGION_CENTER_X] - w;
              RegionMatrix[g + REGION_CENTER_Y] = RegionMatrix[r + REGION_CENTER_Y] - w;
              RegionMatrix[g + REGION_SIZE] = w;
              RegionMatrix[g + REGION_NEXT_SIBLING] = g + PPR;
              RegionMatrix[g + REGION_FIRST_CHILD] = -1;
              RegionMatrix[g + REGION_MASS] = 0;
              RegionMatrix[g + REGION_MASS_CENTER_X] = 0;
              RegionMatrix[g + REGION_MASS_CENTER_Y] = 0;
              g += PPR;
              RegionMatrix[g + REGION_NODE] = -1;
              RegionMatrix[g + REGION_CENTER_X] = RegionMatrix[r + REGION_CENTER_X] - w;
              RegionMatrix[g + REGION_CENTER_Y] = RegionMatrix[r + REGION_CENTER_Y] + w;
              RegionMatrix[g + REGION_SIZE] = w;
              RegionMatrix[g + REGION_NEXT_SIBLING] = g + PPR;
              RegionMatrix[g + REGION_FIRST_CHILD] = -1;
              RegionMatrix[g + REGION_MASS] = 0;
              RegionMatrix[g + REGION_MASS_CENTER_X] = 0;
              RegionMatrix[g + REGION_MASS_CENTER_Y] = 0;
              g += PPR;
              RegionMatrix[g + REGION_NODE] = -1;
              RegionMatrix[g + REGION_CENTER_X] = RegionMatrix[r + REGION_CENTER_X] + w;
              RegionMatrix[g + REGION_CENTER_Y] = RegionMatrix[r + REGION_CENTER_Y] - w;
              RegionMatrix[g + REGION_SIZE] = w;
              RegionMatrix[g + REGION_NEXT_SIBLING] = g + PPR;
              RegionMatrix[g + REGION_FIRST_CHILD] = -1;
              RegionMatrix[g + REGION_MASS] = 0;
              RegionMatrix[g + REGION_MASS_CENTER_X] = 0;
              RegionMatrix[g + REGION_MASS_CENTER_Y] = 0;
              g += PPR;
              RegionMatrix[g + REGION_NODE] = -1;
              RegionMatrix[g + REGION_CENTER_X] = RegionMatrix[r + REGION_CENTER_X] + w;
              RegionMatrix[g + REGION_CENTER_Y] = RegionMatrix[r + REGION_CENTER_Y] + w;
              RegionMatrix[g + REGION_SIZE] = w;
              RegionMatrix[g + REGION_NEXT_SIBLING] = RegionMatrix[r + REGION_NEXT_SIBLING];
              RegionMatrix[g + REGION_FIRST_CHILD] = -1;
              RegionMatrix[g + REGION_MASS] = 0;
              RegionMatrix[g + REGION_MASS_CENTER_X] = 0;
              RegionMatrix[g + REGION_MASS_CENTER_Y] = 0;
              l += 4;
              if (NodeMatrix[RegionMatrix[r + REGION_NODE] + NODE_X] < RegionMatrix[r + REGION_CENTER_X]) {
                if (NodeMatrix[RegionMatrix[r + REGION_NODE] + NODE_Y] < RegionMatrix[r + REGION_CENTER_Y]) {
                  q = RegionMatrix[r + REGION_FIRST_CHILD];
                } else {
                  q = RegionMatrix[r + REGION_FIRST_CHILD] + PPR;
                }
              } else {
                if (NodeMatrix[RegionMatrix[r + REGION_NODE] + NODE_Y] < RegionMatrix[r + REGION_CENTER_Y]) {
                  q = RegionMatrix[r + REGION_FIRST_CHILD] + PPR * 2;
                } else {
                  q = RegionMatrix[r + REGION_FIRST_CHILD] + PPR * 3;
                }
              }
              RegionMatrix[r + REGION_MASS] = NodeMatrix[RegionMatrix[r + REGION_NODE] + NODE_MASS];
              RegionMatrix[r + REGION_MASS_CENTER_X] = NodeMatrix[RegionMatrix[r + REGION_NODE] + NODE_X];
              RegionMatrix[r + REGION_MASS_CENTER_Y] = NodeMatrix[RegionMatrix[r + REGION_NODE] + NODE_Y];
              RegionMatrix[q + REGION_NODE] = RegionMatrix[r + REGION_NODE];
              RegionMatrix[r + REGION_NODE] = -1;
              if (NodeMatrix[n + NODE_X] < RegionMatrix[r + REGION_CENTER_X]) {
                if (NodeMatrix[n + NODE_Y] < RegionMatrix[r + REGION_CENTER_Y]) {
                  q2 = RegionMatrix[r + REGION_FIRST_CHILD];
                } else {
                  q2 = RegionMatrix[r + REGION_FIRST_CHILD] + PPR;
                }
              } else {
                if (NodeMatrix[n + NODE_Y] < RegionMatrix[r + REGION_CENTER_Y]) {
                  q2 = RegionMatrix[r + REGION_FIRST_CHILD] + PPR * 2;
                } else {
                  q2 = RegionMatrix[r + REGION_FIRST_CHILD] + PPR * 3;
                }
              }
              if (q === q2) {
                if (subdivisionAttempts--) {
                  r = q;
                  continue;
                } else {
                  subdivisionAttempts = SUBDIVISION_ATTEMPTS;
                  break;
                }
              }
              RegionMatrix[q2 + REGION_NODE] = n;
              break;
            }
          }
        }
      }
    }
    if (options.barnesHutOptimize) {
      coefficient = options.scalingRatio;
      for (n = 0;n < order; n += PPN) {
        r = 0;
        while (true) {
          if (RegionMatrix[r + REGION_FIRST_CHILD] >= 0) {
            distance = Math.pow(NodeMatrix[n + NODE_X] - RegionMatrix[r + REGION_MASS_CENTER_X], 2) + Math.pow(NodeMatrix[n + NODE_Y] - RegionMatrix[r + REGION_MASS_CENTER_Y], 2);
            s = RegionMatrix[r + REGION_SIZE];
            if (4 * s * s / distance < thetaSquared) {
              xDist = NodeMatrix[n + NODE_X] - RegionMatrix[r + REGION_MASS_CENTER_X];
              yDist = NodeMatrix[n + NODE_Y] - RegionMatrix[r + REGION_MASS_CENTER_Y];
              if (adjustSizes === true) {
                if (distance > 0) {
                  factor = coefficient * NodeMatrix[n + NODE_MASS] * RegionMatrix[r + REGION_MASS] / distance;
                  NodeMatrix[n + NODE_DX] += xDist * factor;
                  NodeMatrix[n + NODE_DY] += yDist * factor;
                } else if (distance < 0) {
                  factor = -coefficient * NodeMatrix[n + NODE_MASS] * RegionMatrix[r + REGION_MASS] / Math.sqrt(distance);
                  NodeMatrix[n + NODE_DX] += xDist * factor;
                  NodeMatrix[n + NODE_DY] += yDist * factor;
                }
              } else {
                if (distance > 0) {
                  factor = coefficient * NodeMatrix[n + NODE_MASS] * RegionMatrix[r + REGION_MASS] / distance;
                  NodeMatrix[n + NODE_DX] += xDist * factor;
                  NodeMatrix[n + NODE_DY] += yDist * factor;
                }
              }
              r = RegionMatrix[r + REGION_NEXT_SIBLING];
              if (r < 0)
                break;
              continue;
            } else {
              r = RegionMatrix[r + REGION_FIRST_CHILD];
              continue;
            }
          } else {
            rn = RegionMatrix[r + REGION_NODE];
            if (rn >= 0 && rn !== n) {
              xDist = NodeMatrix[n + NODE_X] - NodeMatrix[rn + NODE_X];
              yDist = NodeMatrix[n + NODE_Y] - NodeMatrix[rn + NODE_Y];
              distance = xDist * xDist + yDist * yDist;
              if (adjustSizes === true) {
                if (distance > 0) {
                  factor = coefficient * NodeMatrix[n + NODE_MASS] * NodeMatrix[rn + NODE_MASS] / distance;
                  NodeMatrix[n + NODE_DX] += xDist * factor;
                  NodeMatrix[n + NODE_DY] += yDist * factor;
                } else if (distance < 0) {
                  factor = -coefficient * NodeMatrix[n + NODE_MASS] * NodeMatrix[rn + NODE_MASS] / Math.sqrt(distance);
                  NodeMatrix[n + NODE_DX] += xDist * factor;
                  NodeMatrix[n + NODE_DY] += yDist * factor;
                }
              } else {
                if (distance > 0) {
                  factor = coefficient * NodeMatrix[n + NODE_MASS] * NodeMatrix[rn + NODE_MASS] / distance;
                  NodeMatrix[n + NODE_DX] += xDist * factor;
                  NodeMatrix[n + NODE_DY] += yDist * factor;
                }
              }
            }
            r = RegionMatrix[r + REGION_NEXT_SIBLING];
            if (r < 0)
              break;
            continue;
          }
        }
      }
    } else {
      coefficient = options.scalingRatio;
      for (n1 = 0;n1 < order; n1 += PPN) {
        for (n2 = 0;n2 < n1; n2 += PPN) {
          xDist = NodeMatrix[n1 + NODE_X] - NodeMatrix[n2 + NODE_X];
          yDist = NodeMatrix[n1 + NODE_Y] - NodeMatrix[n2 + NODE_Y];
          if (adjustSizes === true) {
            distance = Math.sqrt(xDist * xDist + yDist * yDist) - NodeMatrix[n1 + NODE_SIZE] - NodeMatrix[n2 + NODE_SIZE];
            if (distance > 0) {
              factor = coefficient * NodeMatrix[n1 + NODE_MASS] * NodeMatrix[n2 + NODE_MASS] / distance / distance;
              NodeMatrix[n1 + NODE_DX] += xDist * factor;
              NodeMatrix[n1 + NODE_DY] += yDist * factor;
              NodeMatrix[n2 + NODE_DX] -= xDist * factor;
              NodeMatrix[n2 + NODE_DY] -= yDist * factor;
            } else if (distance < 0) {
              factor = 100 * coefficient * NodeMatrix[n1 + NODE_MASS] * NodeMatrix[n2 + NODE_MASS];
              NodeMatrix[n1 + NODE_DX] += xDist * factor;
              NodeMatrix[n1 + NODE_DY] += yDist * factor;
              NodeMatrix[n2 + NODE_DX] -= xDist * factor;
              NodeMatrix[n2 + NODE_DY] -= yDist * factor;
            }
          } else {
            distance = Math.sqrt(xDist * xDist + yDist * yDist);
            if (distance > 0) {
              factor = coefficient * NodeMatrix[n1 + NODE_MASS] * NodeMatrix[n2 + NODE_MASS] / distance / distance;
              NodeMatrix[n1 + NODE_DX] += xDist * factor;
              NodeMatrix[n1 + NODE_DY] += yDist * factor;
              NodeMatrix[n2 + NODE_DX] -= xDist * factor;
              NodeMatrix[n2 + NODE_DY] -= yDist * factor;
            }
          }
        }
      }
    }
    g = options.gravity / options.scalingRatio;
    coefficient = options.scalingRatio;
    for (n = 0;n < order; n += PPN) {
      factor = 0;
      xDist = NodeMatrix[n + NODE_X];
      yDist = NodeMatrix[n + NODE_Y];
      distance = Math.sqrt(Math.pow(xDist, 2) + Math.pow(yDist, 2));
      if (options.strongGravityMode) {
        if (distance > 0)
          factor = coefficient * NodeMatrix[n + NODE_MASS] * g;
      } else {
        if (distance > 0)
          factor = coefficient * NodeMatrix[n + NODE_MASS] * g / distance;
      }
      NodeMatrix[n + NODE_DX] -= xDist * factor;
      NodeMatrix[n + NODE_DY] -= yDist * factor;
    }
    coefficient = 1 * (options.outboundAttractionDistribution ? outboundAttCompensation : 1);
    for (e = 0;e < size; e += PPE) {
      n1 = EdgeMatrix[e + EDGE_SOURCE];
      n2 = EdgeMatrix[e + EDGE_TARGET];
      w = EdgeMatrix[e + EDGE_WEIGHT];
      ewc = Math.pow(w, options.edgeWeightInfluence);
      xDist = NodeMatrix[n1 + NODE_X] - NodeMatrix[n2 + NODE_X];
      yDist = NodeMatrix[n1 + NODE_Y] - NodeMatrix[n2 + NODE_Y];
      if (adjustSizes === true) {
        distance = Math.sqrt(xDist * xDist + yDist * yDist) - NodeMatrix[n1 + NODE_SIZE] - NodeMatrix[n2 + NODE_SIZE];
        if (options.linLogMode) {
          if (options.outboundAttractionDistribution) {
            if (distance > 0) {
              factor = -coefficient * ewc * Math.log(1 + distance) / distance / NodeMatrix[n1 + NODE_MASS];
            }
          } else {
            if (distance > 0) {
              factor = -coefficient * ewc * Math.log(1 + distance) / distance;
            }
          }
        } else {
          if (options.outboundAttractionDistribution) {
            if (distance > 0) {
              factor = -coefficient * ewc / NodeMatrix[n1 + NODE_MASS];
            }
          } else {
            if (distance > 0) {
              factor = -coefficient * ewc;
            }
          }
        }
      } else {
        distance = Math.sqrt(Math.pow(xDist, 2) + Math.pow(yDist, 2));
        if (options.linLogMode) {
          if (options.outboundAttractionDistribution) {
            if (distance > 0) {
              factor = -coefficient * ewc * Math.log(1 + distance) / distance / NodeMatrix[n1 + NODE_MASS];
            }
          } else {
            if (distance > 0)
              factor = -coefficient * ewc * Math.log(1 + distance) / distance;
          }
        } else {
          if (options.outboundAttractionDistribution) {
            distance = 1;
            factor = -coefficient * ewc / NodeMatrix[n1 + NODE_MASS];
          } else {
            distance = 1;
            factor = -coefficient * ewc;
          }
        }
      }
      if (distance > 0) {
        NodeMatrix[n1 + NODE_DX] += xDist * factor;
        NodeMatrix[n1 + NODE_DY] += yDist * factor;
        NodeMatrix[n2 + NODE_DX] -= xDist * factor;
        NodeMatrix[n2 + NODE_DY] -= yDist * factor;
      }
    }
    var force, swinging, traction, nodespeed, newX, newY;
    if (adjustSizes === true) {
      for (n = 0;n < order; n += PPN) {
        if (NodeMatrix[n + NODE_FIXED] !== 1) {
          force = Math.sqrt(Math.pow(NodeMatrix[n + NODE_DX], 2) + Math.pow(NodeMatrix[n + NODE_DY], 2));
          if (force > MAX_FORCE) {
            NodeMatrix[n + NODE_DX] = NodeMatrix[n + NODE_DX] * MAX_FORCE / force;
            NodeMatrix[n + NODE_DY] = NodeMatrix[n + NODE_DY] * MAX_FORCE / force;
          }
          swinging = NodeMatrix[n + NODE_MASS] * Math.sqrt((NodeMatrix[n + NODE_OLD_DX] - NodeMatrix[n + NODE_DX]) * (NodeMatrix[n + NODE_OLD_DX] - NodeMatrix[n + NODE_DX]) + (NodeMatrix[n + NODE_OLD_DY] - NodeMatrix[n + NODE_DY]) * (NodeMatrix[n + NODE_OLD_DY] - NodeMatrix[n + NODE_DY]));
          traction = Math.sqrt((NodeMatrix[n + NODE_OLD_DX] + NodeMatrix[n + NODE_DX]) * (NodeMatrix[n + NODE_OLD_DX] + NodeMatrix[n + NODE_DX]) + (NodeMatrix[n + NODE_OLD_DY] + NodeMatrix[n + NODE_DY]) * (NodeMatrix[n + NODE_OLD_DY] + NodeMatrix[n + NODE_DY])) / 2;
          nodespeed = 0.1 * Math.log(1 + traction) / (1 + Math.sqrt(swinging));
          newX = NodeMatrix[n + NODE_X] + NodeMatrix[n + NODE_DX] * (nodespeed / options.slowDown);
          NodeMatrix[n + NODE_X] = newX;
          newY = NodeMatrix[n + NODE_Y] + NodeMatrix[n + NODE_DY] * (nodespeed / options.slowDown);
          NodeMatrix[n + NODE_Y] = newY;
        }
      }
    } else {
      for (n = 0;n < order; n += PPN) {
        if (NodeMatrix[n + NODE_FIXED] !== 1) {
          swinging = NodeMatrix[n + NODE_MASS] * Math.sqrt((NodeMatrix[n + NODE_OLD_DX] - NodeMatrix[n + NODE_DX]) * (NodeMatrix[n + NODE_OLD_DX] - NodeMatrix[n + NODE_DX]) + (NodeMatrix[n + NODE_OLD_DY] - NodeMatrix[n + NODE_DY]) * (NodeMatrix[n + NODE_OLD_DY] - NodeMatrix[n + NODE_DY]));
          traction = Math.sqrt((NodeMatrix[n + NODE_OLD_DX] + NodeMatrix[n + NODE_DX]) * (NodeMatrix[n + NODE_OLD_DX] + NodeMatrix[n + NODE_DX]) + (NodeMatrix[n + NODE_OLD_DY] + NodeMatrix[n + NODE_DY]) * (NodeMatrix[n + NODE_OLD_DY] + NodeMatrix[n + NODE_DY])) / 2;
          nodespeed = NodeMatrix[n + NODE_CONVERGENCE] * Math.log(1 + traction) / (1 + Math.sqrt(swinging));
          NodeMatrix[n + NODE_CONVERGENCE] = Math.min(1, Math.sqrt(nodespeed * (Math.pow(NodeMatrix[n + NODE_DX], 2) + Math.pow(NodeMatrix[n + NODE_DY], 2)) / (1 + Math.sqrt(swinging))));
          newX = NodeMatrix[n + NODE_X] + NodeMatrix[n + NODE_DX] * (nodespeed / options.slowDown);
          NodeMatrix[n + NODE_X] = newX;
          newY = NodeMatrix[n + NODE_Y] + NodeMatrix[n + NODE_DY] * (nodespeed / options.slowDown);
          NodeMatrix[n + NODE_Y] = newY;
        }
      }
    }
    return {};
  };
});

// node_modules/graphology-layout-forceatlas2/helpers.js
var require_helpers = __commonJS(function(exports) {
  var PPN = 10;
  var PPE = 3;
  exports.assign = function(target) {
    target = target || {};
    var objects = Array.prototype.slice.call(arguments).slice(1), i, k, l;
    for (i = 0, l = objects.length;i < l; i++) {
      if (!objects[i])
        continue;
      for (k in objects[i])
        target[k] = objects[i][k];
    }
    return target;
  };
  exports.validateSettings = function(settings) {
    if ("linLogMode" in settings && typeof settings.linLogMode !== "boolean")
      return { message: "the `linLogMode` setting should be a boolean." };
    if ("outboundAttractionDistribution" in settings && typeof settings.outboundAttractionDistribution !== "boolean")
      return {
        message: "the `outboundAttractionDistribution` setting should be a boolean."
      };
    if ("adjustSizes" in settings && typeof settings.adjustSizes !== "boolean")
      return { message: "the `adjustSizes` setting should be a boolean." };
    if ("edgeWeightInfluence" in settings && typeof settings.edgeWeightInfluence !== "number")
      return {
        message: "the `edgeWeightInfluence` setting should be a number."
      };
    if ("scalingRatio" in settings && !(typeof settings.scalingRatio === "number" && settings.scalingRatio >= 0))
      return { message: "the `scalingRatio` setting should be a number >= 0." };
    if ("strongGravityMode" in settings && typeof settings.strongGravityMode !== "boolean")
      return { message: "the `strongGravityMode` setting should be a boolean." };
    if ("gravity" in settings && !(typeof settings.gravity === "number" && settings.gravity >= 0))
      return { message: "the `gravity` setting should be a number >= 0." };
    if ("slowDown" in settings && !(typeof settings.slowDown === "number" || settings.slowDown >= 0))
      return { message: "the `slowDown` setting should be a number >= 0." };
    if ("barnesHutOptimize" in settings && typeof settings.barnesHutOptimize !== "boolean")
      return { message: "the `barnesHutOptimize` setting should be a boolean." };
    if ("barnesHutTheta" in settings && !(typeof settings.barnesHutTheta === "number" && settings.barnesHutTheta >= 0))
      return { message: "the `barnesHutTheta` setting should be a number >= 0." };
    return null;
  };
  exports.graphToByteArrays = function(graph, getEdgeWeight) {
    var order = graph.order;
    var size = graph.size;
    var index = {};
    var j;
    var NodeMatrix = new Float32Array(order * PPN);
    var EdgeMatrix = new Float32Array(size * PPE);
    j = 0;
    graph.forEachNode(function(node, attr) {
      index[node] = j;
      NodeMatrix[j] = attr.x;
      NodeMatrix[j + 1] = attr.y;
      NodeMatrix[j + 2] = 0;
      NodeMatrix[j + 3] = 0;
      NodeMatrix[j + 4] = 0;
      NodeMatrix[j + 5] = 0;
      NodeMatrix[j + 6] = 1;
      NodeMatrix[j + 7] = 1;
      NodeMatrix[j + 8] = attr.size || 1;
      NodeMatrix[j + 9] = attr.fixed ? 1 : 0;
      j += PPN;
    });
    j = 0;
    graph.forEachEdge(function(edge, attr, source, target, sa, ta, u) {
      var sj = index[source];
      var tj = index[target];
      var weight = getEdgeWeight(edge, attr, source, target, sa, ta, u);
      NodeMatrix[sj + 6] += weight;
      NodeMatrix[tj + 6] += weight;
      EdgeMatrix[j] = sj;
      EdgeMatrix[j + 1] = tj;
      EdgeMatrix[j + 2] = weight;
      j += PPE;
    });
    return {
      nodes: NodeMatrix,
      edges: EdgeMatrix
    };
  };
  exports.assignLayoutChanges = function(graph, NodeMatrix, outputReducer) {
    var i = 0;
    graph.updateEachNodeAttributes(function(node, attr) {
      attr.x = NodeMatrix[i];
      attr.y = NodeMatrix[i + 1];
      i += PPN;
      return outputReducer ? outputReducer(node, attr) : attr;
    });
  };
  exports.readGraphPositions = function(graph, NodeMatrix) {
    var i = 0;
    graph.forEachNode(function(node, attr) {
      NodeMatrix[i] = attr.x;
      NodeMatrix[i + 1] = attr.y;
      i += PPN;
    });
  };
  exports.collectLayoutChanges = function(graph, NodeMatrix, outputReducer) {
    var nodes = graph.nodes(), positions = {};
    for (var i = 0, j = 0, l = NodeMatrix.length;i < l; i += PPN) {
      if (outputReducer) {
        var newAttr = Object.assign({}, graph.getNodeAttributes(nodes[j]));
        newAttr.x = NodeMatrix[i];
        newAttr.y = NodeMatrix[i + 1];
        newAttr = outputReducer(nodes[j], newAttr);
        positions[nodes[j]] = {
          x: newAttr.x,
          y: newAttr.y
        };
      } else {
        positions[nodes[j]] = {
          x: NodeMatrix[i],
          y: NodeMatrix[i + 1]
        };
      }
      j++;
    }
    return positions;
  };
  exports.createWorker = function createWorker(fn) {
    var xURL = window.URL || window.webkitURL;
    var code = fn.toString();
    var objectUrl = xURL.createObjectURL(new Blob(["(" + code + ").call(this);"], { type: "text/javascript" }));
    var worker = new Worker(objectUrl);
    xURL.revokeObjectURL(objectUrl);
    return worker;
  };
});

// node_modules/graphology-layout-forceatlas2/defaults.js
var require_defaults = __commonJS(function(exports, module) {
  module.exports = {
    linLogMode: false,
    outboundAttractionDistribution: false,
    adjustSizes: false,
    edgeWeightInfluence: 1,
    scalingRatio: 1,
    strongGravityMode: false,
    gravity: 1,
    slowDown: 1,
    barnesHutOptimize: false,
    barnesHutTheta: 0.5
  };
});

// node_modules/graphology-layout-forceatlas2/index.js
var require_graphology_layout_forceatlas2 = __commonJS(function(exports, module) {
  var isGraph = require_is_graph();
  var createEdgeWeightGetter = require_getters().createEdgeWeightGetter;
  var iterate = require_iterate();
  var helpers = require_helpers();
  var DEFAULT_SETTINGS = require_defaults();
  function abstractSynchronousLayout(assign, graph, params) {
    if (!isGraph(graph))
      throw new Error("graphology-layout-forceatlas2: the given graph is not a valid graphology instance.");
    if (typeof params === "number")
      params = { iterations: params };
    var iterations = params.iterations;
    if (typeof iterations !== "number")
      throw new Error("graphology-layout-forceatlas2: invalid number of iterations.");
    if (iterations <= 0)
      throw new Error("graphology-layout-forceatlas2: you should provide a positive number of iterations.");
    var getEdgeWeight = createEdgeWeightGetter("getEdgeWeight" in params ? params.getEdgeWeight : "weight").fromEntry;
    var outputReducer = typeof params.outputReducer === "function" ? params.outputReducer : null;
    var settings = helpers.assign({}, DEFAULT_SETTINGS, params.settings);
    var validationError = helpers.validateSettings(settings);
    if (validationError)
      throw new Error("graphology-layout-forceatlas2: " + validationError.message);
    var matrices = helpers.graphToByteArrays(graph, getEdgeWeight);
    var i;
    for (i = 0;i < iterations; i++)
      iterate(settings, matrices.nodes, matrices.edges);
    if (assign) {
      helpers.assignLayoutChanges(graph, matrices.nodes, outputReducer);
      return;
    }
    return helpers.collectLayoutChanges(graph, matrices.nodes);
  }
  function inferSettings(graph) {
    var order = typeof graph === "number" ? graph : graph.order;
    return {
      barnesHutOptimize: order > 2000,
      strongGravityMode: true,
      gravity: 0.05,
      scalingRatio: 10,
      slowDown: 1 + Math.log(order)
    };
  }
  var synchronousLayout = abstractSynchronousLayout.bind(null, false);
  synchronousLayout.assign = abstractSynchronousLayout.bind(null, true);
  synchronousLayout.inferSettings = inferSettings;
  module.exports = synchronousLayout;
});

// node:events
var SymbolFor = Symbol.for;
var kCapture = Symbol("kCapture");
var kErrorMonitor = SymbolFor("events.errorMonitor");
var kMaxEventTargetListeners = Symbol("events.maxEventTargetListeners");
var kMaxEventTargetListenersWarned = Symbol("events.maxEventTargetListenersWarned");
var kRejection = SymbolFor("nodejs.rejection");
var captureRejectionSymbol = SymbolFor("nodejs.rejection");
var ArrayPrototypeSlice = Array.prototype.slice;
var defaultMaxListeners = 10;
var EventEmitter = function(opts) {
  if (this._events === undefined || this._events === this.__proto__._events)
    this._events = { __proto__: null }, this._eventsCount = 0;
  if (this._maxListeners ??= undefined, this[kCapture] = opts?.captureRejections ? Boolean(opts?.captureRejections) : EventEmitterPrototype[kCapture])
    this.emit = emitWithRejectionCapture;
};
var EventEmitterPrototype = EventEmitter.prototype = {};
EventEmitterPrototype._events = undefined;
EventEmitterPrototype._eventsCount = 0;
EventEmitterPrototype._maxListeners = undefined;
EventEmitterPrototype.setMaxListeners = function(n) {
  return validateNumber(n, "setMaxListeners", 0), this._maxListeners = n, this;
};
EventEmitterPrototype.constructor = EventEmitter;
EventEmitterPrototype.getMaxListeners = function() {
  return this?._maxListeners ?? defaultMaxListeners;
};
function emitError(emitter, args) {
  var { _events: events } = emitter;
  if (args[0] ??= Error("Unhandled error."), !events)
    throw args[0];
  var errorMonitor = events[kErrorMonitor];
  if (errorMonitor)
    for (var handler of ArrayPrototypeSlice.call(errorMonitor))
      handler.apply(emitter, args);
  var handlers = events.error;
  if (!handlers)
    throw args[0];
  for (var handler of ArrayPrototypeSlice.call(handlers))
    handler.apply(emitter, args);
  return true;
}
function addCatch(emitter, promise, type, args) {
  promise.then(undefined, function(err) {
    queueMicrotask(() => emitUnhandledRejectionOrErr(emitter, err, type, args));
  });
}
function emitUnhandledRejectionOrErr(emitter, err, type, args) {
  if (typeof emitter[kRejection] === "function")
    emitter[kRejection](err, type, ...args);
  else
    try {
      emitter[kCapture] = false, emitter.emit("error", err);
    } finally {
      emitter[kCapture] = true;
    }
}
var emitWithoutRejectionCapture = function(type, ...args) {
  if (type === "error")
    return emitError(this, args);
  var { _events: events } = this;
  if (events === undefined)
    return false;
  var handlers = events[type];
  if (handlers === undefined)
    return false;
  let maybeClonedHandlers = handlers.length > 1 ? handlers.slice() : handlers;
  for (let i = 0, { length } = maybeClonedHandlers;i < length; i++) {
    let handler = maybeClonedHandlers[i];
    switch (args.length) {
      case 0:
        handler.call(this);
        break;
      case 1:
        handler.call(this, args[0]);
        break;
      case 2:
        handler.call(this, args[0], args[1]);
        break;
      case 3:
        handler.call(this, args[0], args[1], args[2]);
        break;
      default:
        handler.apply(this, args);
        break;
    }
  }
  return true;
};
var emitWithRejectionCapture = function(type, ...args) {
  if (type === "error")
    return emitError(this, args);
  var { _events: events } = this;
  if (events === undefined)
    return false;
  var handlers = events[type];
  if (handlers === undefined)
    return false;
  let maybeClonedHandlers = handlers.length > 1 ? handlers.slice() : handlers;
  for (let i = 0, { length } = maybeClonedHandlers;i < length; i++) {
    let handler = maybeClonedHandlers[i], result;
    switch (args.length) {
      case 0:
        result = handler.call(this);
        break;
      case 1:
        result = handler.call(this, args[0]);
        break;
      case 2:
        result = handler.call(this, args[0], args[1]);
        break;
      case 3:
        result = handler.call(this, args[0], args[1], args[2]);
        break;
      default:
        result = handler.apply(this, args);
        break;
    }
    if (result !== undefined && typeof result?.then === "function" && result.then === Promise.prototype.then)
      addCatch(this, result, type, args);
  }
  return true;
};
EventEmitterPrototype.emit = emitWithoutRejectionCapture;
EventEmitterPrototype.addListener = function(type, fn) {
  checkListener(fn);
  var events = this._events;
  if (!events)
    events = this._events = { __proto__: null }, this._eventsCount = 0;
  else if (events.newListener)
    this.emit("newListener", type, fn.listener ?? fn);
  var handlers = events[type];
  if (!handlers)
    events[type] = [fn], this._eventsCount++;
  else {
    handlers.push(fn);
    var m = this._maxListeners ?? defaultMaxListeners;
    if (m > 0 && handlers.length > m && !handlers.warned)
      overflowWarning(this, type, handlers);
  }
  return this;
};
EventEmitterPrototype.on = EventEmitterPrototype.addListener;
EventEmitterPrototype.prependListener = function(type, fn) {
  checkListener(fn);
  var events = this._events;
  if (!events)
    events = this._events = { __proto__: null }, this._eventsCount = 0;
  else if (events.newListener)
    this.emit("newListener", type, fn.listener ?? fn);
  var handlers = events[type];
  if (!handlers)
    events[type] = [fn], this._eventsCount++;
  else {
    handlers.unshift(fn);
    var m = this._maxListeners ?? defaultMaxListeners;
    if (m > 0 && handlers.length > m && !handlers.warned)
      overflowWarning(this, type, handlers);
  }
  return this;
};
function overflowWarning(emitter, type, handlers) {
  handlers.warned = true;
  let warn = Error(`Possible EventEmitter memory leak detected. ${handlers.length} ${String(type)} listeners added to [${emitter.constructor.name}]. Use emitter.setMaxListeners() to increase limit`);
  warn.name = "MaxListenersExceededWarning", warn.emitter = emitter, warn.type = type, warn.count = handlers.length, console.warn(warn);
}
function onceWrapper(type, listener, ...args) {
  this.removeListener(type, listener), listener.apply(this, args);
}
EventEmitterPrototype.once = function(type, fn) {
  checkListener(fn);
  let bound = onceWrapper.bind(this, type, fn);
  return bound.listener = fn, this.addListener(type, bound), this;
};
EventEmitterPrototype.prependOnceListener = function(type, fn) {
  checkListener(fn);
  let bound = onceWrapper.bind(this, type, fn);
  return bound.listener = fn, this.prependListener(type, bound), this;
};
EventEmitterPrototype.removeListener = function(type, fn) {
  checkListener(fn);
  var { _events: events } = this;
  if (!events)
    return this;
  var handlers = events[type];
  if (!handlers)
    return this;
  var length = handlers.length;
  let position = -1;
  for (let i = length - 1;i >= 0; i--)
    if (handlers[i] === fn || handlers[i].listener === fn) {
      position = i;
      break;
    }
  if (position < 0)
    return this;
  if (position === 0)
    handlers.shift();
  else
    handlers.splice(position, 1);
  if (handlers.length === 0)
    delete events[type], this._eventsCount--;
  return this;
};
EventEmitterPrototype.off = EventEmitterPrototype.removeListener;
EventEmitterPrototype.removeAllListeners = function(type) {
  var { _events: events } = this;
  if (type && events) {
    if (events[type])
      delete events[type], this._eventsCount--;
  } else
    this._events = { __proto__: null };
  return this;
};
EventEmitterPrototype.listeners = function(type) {
  var { _events: events } = this;
  if (!events)
    return [];
  var handlers = events[type];
  if (!handlers)
    return [];
  return handlers.map((x) => x.listener ?? x);
};
EventEmitterPrototype.rawListeners = function(type) {
  var { _events } = this;
  if (!_events)
    return [];
  var handlers = _events[type];
  if (!handlers)
    return [];
  return handlers.slice();
};
EventEmitterPrototype.listenerCount = function(type) {
  var { _events: events } = this;
  if (!events)
    return 0;
  return events[type]?.length ?? 0;
};
EventEmitterPrototype.eventNames = function() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};
EventEmitterPrototype[kCapture] = false;
function once(emitter, type, options) {
  var signal = options?.signal;
  if (validateAbortSignal(signal, "options.signal"), signal?.aborted)
    throw new AbortError(undefined, { cause: signal?.reason });
  return new Promise((resolve, reject) => {
    let errorListener = (err) => {
      if (emitter.removeListener(type, resolver), signal != null)
        eventTargetAgnosticRemoveListener(signal, "abort", abortListener);
      reject(err);
    }, resolver = (...args) => {
      if (typeof emitter.removeListener === "function")
        emitter.removeListener("error", errorListener);
      if (signal != null)
        eventTargetAgnosticRemoveListener(signal, "abort", abortListener);
      resolve(args);
    };
    if (eventTargetAgnosticAddListener(emitter, type, resolver, { once: true }), type !== "error" && typeof emitter.once === "function")
      emitter.once("error", errorListener);
    function abortListener() {
      eventTargetAgnosticRemoveListener(emitter, type, resolver), eventTargetAgnosticRemoveListener(emitter, "error", errorListener), reject(new AbortError(undefined, { cause: signal?.reason }));
    }
    if (signal != null)
      eventTargetAgnosticAddListener(signal, "abort", abortListener, { once: true });
  });
}
function getEventListeners(emitter, type) {
  return emitter.listeners(type);
}
function setMaxListeners(n, ...eventTargets) {
  validateNumber(n, "setMaxListeners", 0);
  var length;
  if (eventTargets && (length = eventTargets.length))
    for (let i = 0;i < length; i++)
      eventTargets[i].setMaxListeners(n);
  else
    defaultMaxListeners = n;
}
function listenerCount(emitter, type) {
  return emitter.listenerCount(type);
}
function eventTargetAgnosticRemoveListener(emitter, name, listener, flags) {
  if (typeof emitter.removeListener === "function")
    emitter.removeListener(name, listener);
  else
    emitter.removeEventListener(name, listener, flags);
}
function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
  if (typeof emitter.on === "function")
    if (flags.once)
      emitter.once(name, listener);
    else
      emitter.on(name, listener);
  else
    emitter.addEventListener(name, listener, flags);
}

class AbortError extends Error {
  constructor(message = "The operation was aborted", options = undefined) {
    if (options !== undefined && typeof options !== "object")
      throw ERR_INVALID_ARG_TYPE("options", "Object", options);
    super(message, options);
    this.code = "ABORT_ERR", this.name = "AbortError";
  }
}
function ERR_INVALID_ARG_TYPE(name, type, value) {
  let err = TypeError(`The "${name}" argument must be of type ${type}. Received ${value}`);
  return err.code = "ERR_INVALID_ARG_TYPE", err;
}
function ERR_OUT_OF_RANGE(name, range, value) {
  let err = RangeError(`The "${name}" argument is out of range. It must be ${range}. Received ${value}`);
  return err.code = "ERR_OUT_OF_RANGE", err;
}
function validateAbortSignal(signal, name) {
  if (signal !== undefined && (signal === null || typeof signal !== "object" || !("aborted" in signal)))
    throw ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
}
function validateNumber(value, name, min, max) {
  if (typeof value !== "number")
    throw ERR_INVALID_ARG_TYPE(name, "number", value);
  if (min != null && value < min || max != null && value > max || (min != null || max != null) && Number.isNaN(value))
    throw ERR_OUT_OF_RANGE(name, `${min != null ? `>= ${min}` : ""}${min != null && max != null ? " && " : ""}${max != null ? `<= ${max}` : ""}`, value);
}
function checkListener(listener) {
  if (typeof listener !== "function")
    throw TypeError("The listener must be a function");
}
function validateBoolean(value, name) {
  if (typeof value !== "boolean")
    throw ERR_INVALID_ARG_TYPE(name, "boolean", value);
}
function getMaxListeners(emitterOrTarget) {
  return emitterOrTarget?._maxListeners ?? defaultMaxListeners;
}
function addAbortListener(signal, listener) {
  if (signal === undefined)
    throw ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
  if (validateAbortSignal(signal, "signal"), typeof listener !== "function")
    throw ERR_INVALID_ARG_TYPE("listener", "function", listener);
  let removeEventListener;
  if (signal.aborted)
    queueMicrotask(() => listener());
  else
    signal.addEventListener("abort", listener, { __proto__: null, once: true }), removeEventListener = () => {
      signal.removeEventListener("abort", listener);
    };
  return { __proto__: null, [Symbol.dispose]() {
    removeEventListener?.();
  } };
}
Object.defineProperties(EventEmitter, { captureRejections: { get() {
  return EventEmitterPrototype[kCapture];
}, set(value) {
  validateBoolean(value, "EventEmitter.captureRejections"), EventEmitterPrototype[kCapture] = value;
}, enumerable: true }, defaultMaxListeners: { enumerable: true, get: () => defaultMaxListeners, set: (arg) => {
  validateNumber(arg, "defaultMaxListeners", 0), defaultMaxListeners = arg;
} }, kMaxEventTargetListeners: { value: kMaxEventTargetListeners, enumerable: false, configurable: false, writable: false }, kMaxEventTargetListenersWarned: { value: kMaxEventTargetListenersWarned, enumerable: false, configurable: false, writable: false } });
Object.assign(EventEmitter, { once, getEventListeners, getMaxListeners, setMaxListeners, EventEmitter, usingDomains: false, captureRejectionSymbol, errorMonitor: kErrorMonitor, addAbortListener, init: EventEmitter, listenerCount });

// node_modules/graphology/dist/graphology.mjs
function assignPolyfill() {
  const target = arguments[0];
  for (let i = 1, l = arguments.length;i < l; i++) {
    if (!arguments[i])
      continue;
    for (const k in arguments[i])
      target[k] = arguments[i][k];
  }
  return target;
}
var assign = assignPolyfill;
if (typeof Object.assign === "function")
  assign = Object.assign;
function getMatchingEdge(graph, source, target, type) {
  const sourceData = graph._nodes.get(source);
  let edge = null;
  if (!sourceData)
    return edge;
  if (type === "mixed") {
    edge = sourceData.out && sourceData.out[target] || sourceData.undirected && sourceData.undirected[target];
  } else if (type === "directed") {
    edge = sourceData.out && sourceData.out[target];
  } else {
    edge = sourceData.undirected && sourceData.undirected[target];
  }
  return edge;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null;
}
function isEmpty(o) {
  let k;
  for (k in o)
    return false;
  return true;
}
function privateProperty(target, name, value) {
  Object.defineProperty(target, name, {
    enumerable: false,
    configurable: false,
    writable: true,
    value
  });
}
function readOnlyProperty(target, name, value) {
  const descriptor = {
    enumerable: true,
    configurable: true
  };
  if (typeof value === "function") {
    descriptor.get = value;
  } else {
    descriptor.value = value;
    descriptor.writable = false;
  }
  Object.defineProperty(target, name, descriptor);
}
function validateHints(hints) {
  if (!isPlainObject(hints))
    return false;
  if (hints.attributes && !Array.isArray(hints.attributes))
    return false;
  return true;
}
function incrementalIdStartingFromRandomByte() {
  let i = Math.floor(Math.random() * 256) & 255;
  return () => {
    return i++;
  };
}
function chain() {
  const iterables = arguments;
  let current = null;
  let i = -1;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      let step = null;
      do {
        if (current === null) {
          i++;
          if (i >= iterables.length)
            return { done: true };
          current = iterables[i][Symbol.iterator]();
        }
        step = current.next();
        if (step.done) {
          current = null;
          continue;
        }
        break;
      } while (true);
      return step;
    }
  };
}
function emptyIterator() {
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      return { done: true };
    }
  };
}

class GraphError extends Error {
  constructor(message) {
    super();
    this.name = "GraphError";
    this.message = message;
  }
}

class InvalidArgumentsGraphError extends GraphError {
  constructor(message) {
    super(message);
    this.name = "InvalidArgumentsGraphError";
    if (typeof Error.captureStackTrace === "function")
      Error.captureStackTrace(this, InvalidArgumentsGraphError.prototype.constructor);
  }
}

class NotFoundGraphError extends GraphError {
  constructor(message) {
    super(message);
    this.name = "NotFoundGraphError";
    if (typeof Error.captureStackTrace === "function")
      Error.captureStackTrace(this, NotFoundGraphError.prototype.constructor);
  }
}

class UsageGraphError extends GraphError {
  constructor(message) {
    super(message);
    this.name = "UsageGraphError";
    if (typeof Error.captureStackTrace === "function")
      Error.captureStackTrace(this, UsageGraphError.prototype.constructor);
  }
}
function MixedNodeData(key, attributes) {
  this.key = key;
  this.attributes = attributes;
  this.clear();
}
MixedNodeData.prototype.clear = function() {
  this.inDegree = 0;
  this.outDegree = 0;
  this.undirectedDegree = 0;
  this.undirectedLoops = 0;
  this.directedLoops = 0;
  this.in = {};
  this.out = {};
  this.undirected = {};
};
function DirectedNodeData(key, attributes) {
  this.key = key;
  this.attributes = attributes;
  this.clear();
}
DirectedNodeData.prototype.clear = function() {
  this.inDegree = 0;
  this.outDegree = 0;
  this.directedLoops = 0;
  this.in = {};
  this.out = {};
};
function UndirectedNodeData(key, attributes) {
  this.key = key;
  this.attributes = attributes;
  this.clear();
}
UndirectedNodeData.prototype.clear = function() {
  this.undirectedDegree = 0;
  this.undirectedLoops = 0;
  this.undirected = {};
};
function EdgeData(undirected, key, source, target, attributes) {
  this.key = key;
  this.attributes = attributes;
  this.undirected = undirected;
  this.source = source;
  this.target = target;
}
EdgeData.prototype.attach = function() {
  let outKey = "out";
  let inKey = "in";
  if (this.undirected)
    outKey = inKey = "undirected";
  const source = this.source.key;
  const target = this.target.key;
  this.source[outKey][target] = this;
  if (this.undirected && source === target)
    return;
  this.target[inKey][source] = this;
};
EdgeData.prototype.attachMulti = function() {
  let outKey = "out";
  let inKey = "in";
  const source = this.source.key;
  const target = this.target.key;
  if (this.undirected)
    outKey = inKey = "undirected";
  const adj = this.source[outKey];
  const head = adj[target];
  if (typeof head === "undefined") {
    adj[target] = this;
    if (!(this.undirected && source === target)) {
      this.target[inKey][source] = this;
    }
    return;
  }
  head.previous = this;
  this.next = head;
  adj[target] = this;
  this.target[inKey][source] = this;
};
EdgeData.prototype.detach = function() {
  const source = this.source.key;
  const target = this.target.key;
  let outKey = "out";
  let inKey = "in";
  if (this.undirected)
    outKey = inKey = "undirected";
  delete this.source[outKey][target];
  delete this.target[inKey][source];
};
EdgeData.prototype.detachMulti = function() {
  const source = this.source.key;
  const target = this.target.key;
  let outKey = "out";
  let inKey = "in";
  if (this.undirected)
    outKey = inKey = "undirected";
  if (this.previous === undefined) {
    if (this.next === undefined) {
      delete this.source[outKey][target];
      delete this.target[inKey][source];
    } else {
      this.next.previous = undefined;
      this.source[outKey][target] = this.next;
      this.target[inKey][source] = this.next;
    }
  } else {
    this.previous.next = this.next;
    if (this.next !== undefined) {
      this.next.previous = this.previous;
    }
  }
};
var NODE = 0;
var SOURCE = 1;
var TARGET = 2;
var OPPOSITE = 3;
function findRelevantNodeData(graph, method, mode, nodeOrEdge, nameOrEdge, add1, add2) {
  let nodeData, edgeData, arg1, arg2;
  nodeOrEdge = "" + nodeOrEdge;
  if (mode === NODE) {
    nodeData = graph._nodes.get(nodeOrEdge);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.${method}: could not find the "${nodeOrEdge}" node in the graph.`);
    arg1 = nameOrEdge;
    arg2 = add1;
  } else if (mode === OPPOSITE) {
    nameOrEdge = "" + nameOrEdge;
    edgeData = graph._edges.get(nameOrEdge);
    if (!edgeData)
      throw new NotFoundGraphError(`Graph.${method}: could not find the "${nameOrEdge}" edge in the graph.`);
    const source = edgeData.source.key;
    const target = edgeData.target.key;
    if (nodeOrEdge === source) {
      nodeData = edgeData.target;
    } else if (nodeOrEdge === target) {
      nodeData = edgeData.source;
    } else {
      throw new NotFoundGraphError(`Graph.${method}: the "${nodeOrEdge}" node is not attached to the "${nameOrEdge}" edge (${source}, ${target}).`);
    }
    arg1 = add1;
    arg2 = add2;
  } else {
    edgeData = graph._edges.get(nodeOrEdge);
    if (!edgeData)
      throw new NotFoundGraphError(`Graph.${method}: could not find the "${nodeOrEdge}" edge in the graph.`);
    if (mode === SOURCE) {
      nodeData = edgeData.source;
    } else {
      nodeData = edgeData.target;
    }
    arg1 = nameOrEdge;
    arg2 = add1;
  }
  return [nodeData, arg1, arg2];
}
function attachNodeAttributeGetter(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, name] = findRelevantNodeData(this, method, mode, nodeOrEdge, nameOrEdge, add1);
    return data.attributes[name];
  };
}
function attachNodeAttributesGetter(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge) {
    const [data] = findRelevantNodeData(this, method, mode, nodeOrEdge, nameOrEdge);
    return data.attributes;
  };
}
function attachNodeAttributeChecker(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, name] = findRelevantNodeData(this, method, mode, nodeOrEdge, nameOrEdge, add1);
    return data.attributes.hasOwnProperty(name);
  };
}
function attachNodeAttributeSetter(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1, add2) {
    const [data, name, value] = findRelevantNodeData(this, method, mode, nodeOrEdge, nameOrEdge, add1, add2);
    data.attributes[name] = value;
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "set",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachNodeAttributeUpdater(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1, add2) {
    const [data, name, updater] = findRelevantNodeData(this, method, mode, nodeOrEdge, nameOrEdge, add1, add2);
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(`Graph.${method}: updater should be a function.`);
    const attributes = data.attributes;
    const value = updater(attributes[name]);
    attributes[name] = value;
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "set",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachNodeAttributeRemover(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, name] = findRelevantNodeData(this, method, mode, nodeOrEdge, nameOrEdge, add1);
    delete data.attributes[name];
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "remove",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachNodeAttributesReplacer(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, attributes] = findRelevantNodeData(this, method, mode, nodeOrEdge, nameOrEdge, add1);
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(`Graph.${method}: provided attributes are not a plain object.`);
    data.attributes = attributes;
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "replace",
      attributes: data.attributes
    });
    return this;
  };
}
function attachNodeAttributesMerger(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, attributes] = findRelevantNodeData(this, method, mode, nodeOrEdge, nameOrEdge, add1);
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(`Graph.${method}: provided attributes are not a plain object.`);
    assign(data.attributes, attributes);
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "merge",
      attributes: data.attributes,
      data: attributes
    });
    return this;
  };
}
function attachNodeAttributesUpdater(Class, method, mode) {
  Class.prototype[method] = function(nodeOrEdge, nameOrEdge, add1) {
    const [data, updater] = findRelevantNodeData(this, method, mode, nodeOrEdge, nameOrEdge, add1);
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(`Graph.${method}: provided updater is not a function.`);
    data.attributes = updater(data.attributes);
    this.emit("nodeAttributesUpdated", {
      key: data.key,
      type: "update",
      attributes: data.attributes
    });
    return this;
  };
}
var NODE_ATTRIBUTES_METHODS = [
  {
    name: (element) => `get${element}Attribute`,
    attacher: attachNodeAttributeGetter
  },
  {
    name: (element) => `get${element}Attributes`,
    attacher: attachNodeAttributesGetter
  },
  {
    name: (element) => `has${element}Attribute`,
    attacher: attachNodeAttributeChecker
  },
  {
    name: (element) => `set${element}Attribute`,
    attacher: attachNodeAttributeSetter
  },
  {
    name: (element) => `update${element}Attribute`,
    attacher: attachNodeAttributeUpdater
  },
  {
    name: (element) => `remove${element}Attribute`,
    attacher: attachNodeAttributeRemover
  },
  {
    name: (element) => `replace${element}Attributes`,
    attacher: attachNodeAttributesReplacer
  },
  {
    name: (element) => `merge${element}Attributes`,
    attacher: attachNodeAttributesMerger
  },
  {
    name: (element) => `update${element}Attributes`,
    attacher: attachNodeAttributesUpdater
  }
];
function attachNodeAttributesMethods(Graph) {
  NODE_ATTRIBUTES_METHODS.forEach(function({ name, attacher }) {
    attacher(Graph, name("Node"), NODE);
    attacher(Graph, name("Source"), SOURCE);
    attacher(Graph, name("Target"), TARGET);
    attacher(Graph, name("Opposite"), OPPOSITE);
  });
}
function attachEdgeAttributeGetter(Class, method, type) {
  Class.prototype[method] = function(element, name) {
    let data;
    if (this.type !== "mixed" && type !== "mixed" && type !== this.type)
      throw new UsageGraphError(`Graph.${method}: cannot find this type of edges in your ${this.type} graph.`);
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(`Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`);
      const source = "" + element;
      const target = "" + name;
      name = arguments[2];
      data = getMatchingEdge(this, source, target, type);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`);
    } else {
      if (type !== "mixed")
        throw new UsageGraphError(`Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`);
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find the "${element}" edge in the graph.`);
    }
    return data.attributes[name];
  };
}
function attachEdgeAttributesGetter(Class, method, type) {
  Class.prototype[method] = function(element) {
    let data;
    if (this.type !== "mixed" && type !== "mixed" && type !== this.type)
      throw new UsageGraphError(`Graph.${method}: cannot find this type of edges in your ${this.type} graph.`);
    if (arguments.length > 1) {
      if (this.multi)
        throw new UsageGraphError(`Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`);
      const source = "" + element, target = "" + arguments[1];
      data = getMatchingEdge(this, source, target, type);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`);
    } else {
      if (type !== "mixed")
        throw new UsageGraphError(`Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`);
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find the "${element}" edge in the graph.`);
    }
    return data.attributes;
  };
}
function attachEdgeAttributeChecker(Class, method, type) {
  Class.prototype[method] = function(element, name) {
    let data;
    if (this.type !== "mixed" && type !== "mixed" && type !== this.type)
      throw new UsageGraphError(`Graph.${method}: cannot find this type of edges in your ${this.type} graph.`);
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(`Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`);
      const source = "" + element;
      const target = "" + name;
      name = arguments[2];
      data = getMatchingEdge(this, source, target, type);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`);
    } else {
      if (type !== "mixed")
        throw new UsageGraphError(`Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`);
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find the "${element}" edge in the graph.`);
    }
    return data.attributes.hasOwnProperty(name);
  };
}
function attachEdgeAttributeSetter(Class, method, type) {
  Class.prototype[method] = function(element, name, value) {
    let data;
    if (this.type !== "mixed" && type !== "mixed" && type !== this.type)
      throw new UsageGraphError(`Graph.${method}: cannot find this type of edges in your ${this.type} graph.`);
    if (arguments.length > 3) {
      if (this.multi)
        throw new UsageGraphError(`Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`);
      const source = "" + element;
      const target = "" + name;
      name = arguments[2];
      value = arguments[3];
      data = getMatchingEdge(this, source, target, type);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`);
    } else {
      if (type !== "mixed")
        throw new UsageGraphError(`Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`);
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find the "${element}" edge in the graph.`);
    }
    data.attributes[name] = value;
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "set",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachEdgeAttributeUpdater(Class, method, type) {
  Class.prototype[method] = function(element, name, updater) {
    let data;
    if (this.type !== "mixed" && type !== "mixed" && type !== this.type)
      throw new UsageGraphError(`Graph.${method}: cannot find this type of edges in your ${this.type} graph.`);
    if (arguments.length > 3) {
      if (this.multi)
        throw new UsageGraphError(`Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`);
      const source = "" + element;
      const target = "" + name;
      name = arguments[2];
      updater = arguments[3];
      data = getMatchingEdge(this, source, target, type);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`);
    } else {
      if (type !== "mixed")
        throw new UsageGraphError(`Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`);
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find the "${element}" edge in the graph.`);
    }
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(`Graph.${method}: updater should be a function.`);
    data.attributes[name] = updater(data.attributes[name]);
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "set",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachEdgeAttributeRemover(Class, method, type) {
  Class.prototype[method] = function(element, name) {
    let data;
    if (this.type !== "mixed" && type !== "mixed" && type !== this.type)
      throw new UsageGraphError(`Graph.${method}: cannot find this type of edges in your ${this.type} graph.`);
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(`Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`);
      const source = "" + element;
      const target = "" + name;
      name = arguments[2];
      data = getMatchingEdge(this, source, target, type);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`);
    } else {
      if (type !== "mixed")
        throw new UsageGraphError(`Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`);
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find the "${element}" edge in the graph.`);
    }
    delete data.attributes[name];
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "remove",
      attributes: data.attributes,
      name
    });
    return this;
  };
}
function attachEdgeAttributesReplacer(Class, method, type) {
  Class.prototype[method] = function(element, attributes) {
    let data;
    if (this.type !== "mixed" && type !== "mixed" && type !== this.type)
      throw new UsageGraphError(`Graph.${method}: cannot find this type of edges in your ${this.type} graph.`);
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(`Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`);
      const source = "" + element, target = "" + attributes;
      attributes = arguments[2];
      data = getMatchingEdge(this, source, target, type);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`);
    } else {
      if (type !== "mixed")
        throw new UsageGraphError(`Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`);
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find the "${element}" edge in the graph.`);
    }
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(`Graph.${method}: provided attributes are not a plain object.`);
    data.attributes = attributes;
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "replace",
      attributes: data.attributes
    });
    return this;
  };
}
function attachEdgeAttributesMerger(Class, method, type) {
  Class.prototype[method] = function(element, attributes) {
    let data;
    if (this.type !== "mixed" && type !== "mixed" && type !== this.type)
      throw new UsageGraphError(`Graph.${method}: cannot find this type of edges in your ${this.type} graph.`);
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(`Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`);
      const source = "" + element, target = "" + attributes;
      attributes = arguments[2];
      data = getMatchingEdge(this, source, target, type);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`);
    } else {
      if (type !== "mixed")
        throw new UsageGraphError(`Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`);
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find the "${element}" edge in the graph.`);
    }
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(`Graph.${method}: provided attributes are not a plain object.`);
    assign(data.attributes, attributes);
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "merge",
      attributes: data.attributes,
      data: attributes
    });
    return this;
  };
}
function attachEdgeAttributesUpdater(Class, method, type) {
  Class.prototype[method] = function(element, updater) {
    let data;
    if (this.type !== "mixed" && type !== "mixed" && type !== this.type)
      throw new UsageGraphError(`Graph.${method}: cannot find this type of edges in your ${this.type} graph.`);
    if (arguments.length > 2) {
      if (this.multi)
        throw new UsageGraphError(`Graph.${method}: cannot use a {source,target} combo when asking about an edge's attributes in a MultiGraph since we cannot infer the one you want information about.`);
      const source = "" + element, target = "" + updater;
      updater = arguments[2];
      data = getMatchingEdge(this, source, target, type);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find an edge for the given path ("${source}" - "${target}").`);
    } else {
      if (type !== "mixed")
        throw new UsageGraphError(`Graph.${method}: calling this method with only a key (vs. a source and target) does not make sense since an edge with this key could have the other type.`);
      element = "" + element;
      data = this._edges.get(element);
      if (!data)
        throw new NotFoundGraphError(`Graph.${method}: could not find the "${element}" edge in the graph.`);
    }
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError(`Graph.${method}: provided updater is not a function.`);
    data.attributes = updater(data.attributes);
    this.emit("edgeAttributesUpdated", {
      key: data.key,
      type: "update",
      attributes: data.attributes
    });
    return this;
  };
}
var EDGE_ATTRIBUTES_METHODS = [
  {
    name: (element) => `get${element}Attribute`,
    attacher: attachEdgeAttributeGetter
  },
  {
    name: (element) => `get${element}Attributes`,
    attacher: attachEdgeAttributesGetter
  },
  {
    name: (element) => `has${element}Attribute`,
    attacher: attachEdgeAttributeChecker
  },
  {
    name: (element) => `set${element}Attribute`,
    attacher: attachEdgeAttributeSetter
  },
  {
    name: (element) => `update${element}Attribute`,
    attacher: attachEdgeAttributeUpdater
  },
  {
    name: (element) => `remove${element}Attribute`,
    attacher: attachEdgeAttributeRemover
  },
  {
    name: (element) => `replace${element}Attributes`,
    attacher: attachEdgeAttributesReplacer
  },
  {
    name: (element) => `merge${element}Attributes`,
    attacher: attachEdgeAttributesMerger
  },
  {
    name: (element) => `update${element}Attributes`,
    attacher: attachEdgeAttributesUpdater
  }
];
function attachEdgeAttributesMethods(Graph) {
  EDGE_ATTRIBUTES_METHODS.forEach(function({ name, attacher }) {
    attacher(Graph, name("Edge"), "mixed");
    attacher(Graph, name("DirectedEdge"), "directed");
    attacher(Graph, name("UndirectedEdge"), "undirected");
  });
}
var EDGES_ITERATION = [
  {
    name: "edges",
    type: "mixed"
  },
  {
    name: "inEdges",
    type: "directed",
    direction: "in"
  },
  {
    name: "outEdges",
    type: "directed",
    direction: "out"
  },
  {
    name: "inboundEdges",
    type: "mixed",
    direction: "in"
  },
  {
    name: "outboundEdges",
    type: "mixed",
    direction: "out"
  },
  {
    name: "directedEdges",
    type: "directed"
  },
  {
    name: "undirectedEdges",
    type: "undirected"
  }
];
function forEachSimple(breakable, object, callback, avoid) {
  let shouldBreak = false;
  for (const k in object) {
    if (k === avoid)
      continue;
    const edgeData = object[k];
    shouldBreak = callback(edgeData.key, edgeData.attributes, edgeData.source.key, edgeData.target.key, edgeData.source.attributes, edgeData.target.attributes, edgeData.undirected);
    if (breakable && shouldBreak)
      return edgeData.key;
  }
  return;
}
function forEachMulti(breakable, object, callback, avoid) {
  let edgeData, source, target;
  let shouldBreak = false;
  for (const k in object) {
    if (k === avoid)
      continue;
    edgeData = object[k];
    do {
      source = edgeData.source;
      target = edgeData.target;
      shouldBreak = callback(edgeData.key, edgeData.attributes, source.key, target.key, source.attributes, target.attributes, edgeData.undirected);
      if (breakable && shouldBreak)
        return edgeData.key;
      edgeData = edgeData.next;
    } while (edgeData !== undefined);
  }
  return;
}
function createIterator(object, avoid) {
  const keys = Object.keys(object);
  const l = keys.length;
  let edgeData;
  let i = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      do {
        if (!edgeData) {
          if (i >= l)
            return { done: true };
          const k = keys[i++];
          if (k === avoid) {
            edgeData = undefined;
            continue;
          }
          edgeData = object[k];
        } else {
          edgeData = edgeData.next;
        }
      } while (!edgeData);
      return {
        done: false,
        value: {
          edge: edgeData.key,
          attributes: edgeData.attributes,
          source: edgeData.source.key,
          target: edgeData.target.key,
          sourceAttributes: edgeData.source.attributes,
          targetAttributes: edgeData.target.attributes,
          undirected: edgeData.undirected
        }
      };
    }
  };
}
function forEachForKeySimple(breakable, object, k, callback) {
  const edgeData = object[k];
  if (!edgeData)
    return;
  const sourceData = edgeData.source;
  const targetData = edgeData.target;
  if (callback(edgeData.key, edgeData.attributes, sourceData.key, targetData.key, sourceData.attributes, targetData.attributes, edgeData.undirected) && breakable)
    return edgeData.key;
}
function forEachForKeyMulti(breakable, object, k, callback) {
  let edgeData = object[k];
  if (!edgeData)
    return;
  let shouldBreak = false;
  do {
    shouldBreak = callback(edgeData.key, edgeData.attributes, edgeData.source.key, edgeData.target.key, edgeData.source.attributes, edgeData.target.attributes, edgeData.undirected);
    if (breakable && shouldBreak)
      return edgeData.key;
    edgeData = edgeData.next;
  } while (edgeData !== undefined);
  return;
}
function createIteratorForKey(object, k) {
  let edgeData = object[k];
  if (edgeData.next !== undefined) {
    return {
      [Symbol.iterator]() {
        return this;
      },
      next() {
        if (!edgeData)
          return { done: true };
        const value = {
          edge: edgeData.key,
          attributes: edgeData.attributes,
          source: edgeData.source.key,
          target: edgeData.target.key,
          sourceAttributes: edgeData.source.attributes,
          targetAttributes: edgeData.target.attributes,
          undirected: edgeData.undirected
        };
        edgeData = edgeData.next;
        return {
          done: false,
          value
        };
      }
    };
  }
  let done = false;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      if (done === true)
        return { done: true };
      done = true;
      return {
        done: false,
        value: {
          edge: edgeData.key,
          attributes: edgeData.attributes,
          source: edgeData.source.key,
          target: edgeData.target.key,
          sourceAttributes: edgeData.source.attributes,
          targetAttributes: edgeData.target.attributes,
          undirected: edgeData.undirected
        }
      };
    }
  };
}
function createEdgeArray(graph, type) {
  if (graph.size === 0)
    return [];
  if (type === "mixed" || type === graph.type) {
    return Array.from(graph._edges.keys());
  }
  const size = type === "undirected" ? graph.undirectedSize : graph.directedSize;
  const list = new Array(size), mask = type === "undirected";
  const iterator = graph._edges.values();
  let i = 0;
  let step, data;
  while (step = iterator.next(), step.done !== true) {
    data = step.value;
    if (data.undirected === mask)
      list[i++] = data.key;
  }
  return list;
}
function forEachEdge(breakable, graph, type, callback) {
  if (graph.size === 0)
    return;
  const shouldFilter = type !== "mixed" && type !== graph.type;
  const mask = type === "undirected";
  let step, data;
  let shouldBreak = false;
  const iterator = graph._edges.values();
  while (step = iterator.next(), step.done !== true) {
    data = step.value;
    if (shouldFilter && data.undirected !== mask)
      continue;
    const { key, attributes, source, target } = data;
    shouldBreak = callback(key, attributes, source.key, target.key, source.attributes, target.attributes, data.undirected);
    if (breakable && shouldBreak)
      return key;
  }
  return;
}
function createEdgeIterator(graph, type) {
  if (graph.size === 0)
    return emptyIterator();
  const shouldFilter = type !== "mixed" && type !== graph.type;
  const mask = type === "undirected";
  const iterator = graph._edges.values();
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      let step, data;
      while (true) {
        step = iterator.next();
        if (step.done)
          return step;
        data = step.value;
        if (shouldFilter && data.undirected !== mask)
          continue;
        break;
      }
      const value = {
        edge: data.key,
        attributes: data.attributes,
        source: data.source.key,
        target: data.target.key,
        sourceAttributes: data.source.attributes,
        targetAttributes: data.target.attributes,
        undirected: data.undirected
      };
      return { value, done: false };
    }
  };
}
function forEachEdgeForNode(breakable, multi, type, direction, nodeData, callback) {
  const fn = multi ? forEachMulti : forEachSimple;
  let found;
  if (type !== "undirected") {
    if (direction !== "out") {
      found = fn(breakable, nodeData.in, callback);
      if (breakable && found)
        return found;
    }
    if (direction !== "in") {
      found = fn(breakable, nodeData.out, callback, !direction ? nodeData.key : undefined);
      if (breakable && found)
        return found;
    }
  }
  if (type !== "directed") {
    found = fn(breakable, nodeData.undirected, callback);
    if (breakable && found)
      return found;
  }
  return;
}
function createEdgeArrayForNode(multi, type, direction, nodeData) {
  const edges = [];
  forEachEdgeForNode(false, multi, type, direction, nodeData, function(key) {
    edges.push(key);
  });
  return edges;
}
function createEdgeIteratorForNode(type, direction, nodeData) {
  let iterator = emptyIterator();
  if (type !== "undirected") {
    if (direction !== "out" && typeof nodeData.in !== "undefined")
      iterator = chain(iterator, createIterator(nodeData.in));
    if (direction !== "in" && typeof nodeData.out !== "undefined")
      iterator = chain(iterator, createIterator(nodeData.out, !direction ? nodeData.key : undefined));
  }
  if (type !== "directed" && typeof nodeData.undirected !== "undefined") {
    iterator = chain(iterator, createIterator(nodeData.undirected));
  }
  return iterator;
}
function forEachEdgeForPath(breakable, type, multi, direction, sourceData, target, callback) {
  const fn = multi ? forEachForKeyMulti : forEachForKeySimple;
  let found;
  if (type !== "undirected") {
    if (typeof sourceData.in !== "undefined" && direction !== "out") {
      found = fn(breakable, sourceData.in, target, callback);
      if (breakable && found)
        return found;
    }
    if (typeof sourceData.out !== "undefined" && direction !== "in" && (direction || sourceData.key !== target)) {
      found = fn(breakable, sourceData.out, target, callback);
      if (breakable && found)
        return found;
    }
  }
  if (type !== "directed") {
    if (typeof sourceData.undirected !== "undefined") {
      found = fn(breakable, sourceData.undirected, target, callback);
      if (breakable && found)
        return found;
    }
  }
  return;
}
function createEdgeArrayForPath(type, multi, direction, sourceData, target) {
  const edges = [];
  forEachEdgeForPath(false, type, multi, direction, sourceData, target, function(key) {
    edges.push(key);
  });
  return edges;
}
function createEdgeIteratorForPath(type, direction, sourceData, target) {
  let iterator = emptyIterator();
  if (type !== "undirected") {
    if (typeof sourceData.in !== "undefined" && direction !== "out" && target in sourceData.in)
      iterator = chain(iterator, createIteratorForKey(sourceData.in, target));
    if (typeof sourceData.out !== "undefined" && direction !== "in" && target in sourceData.out && (direction || sourceData.key !== target))
      iterator = chain(iterator, createIteratorForKey(sourceData.out, target));
  }
  if (type !== "directed") {
    if (typeof sourceData.undirected !== "undefined" && target in sourceData.undirected)
      iterator = chain(iterator, createIteratorForKey(sourceData.undirected, target));
  }
  return iterator;
}
function attachEdgeArrayCreator(Class, description) {
  const { name, type, direction } = description;
  Class.prototype[name] = function(source, target) {
    if (type !== "mixed" && this.type !== "mixed" && type !== this.type)
      return [];
    if (!arguments.length)
      return createEdgeArray(this, type);
    if (arguments.length === 1) {
      source = "" + source;
      const nodeData = this._nodes.get(source);
      if (typeof nodeData === "undefined")
        throw new NotFoundGraphError(`Graph.${name}: could not find the "${source}" node in the graph.`);
      return createEdgeArrayForNode(this.multi, type === "mixed" ? this.type : type, direction, nodeData);
    }
    if (arguments.length === 2) {
      source = "" + source;
      target = "" + target;
      const sourceData = this._nodes.get(source);
      if (!sourceData)
        throw new NotFoundGraphError(`Graph.${name}:  could not find the "${source}" source node in the graph.`);
      if (!this._nodes.has(target))
        throw new NotFoundGraphError(`Graph.${name}:  could not find the "${target}" target node in the graph.`);
      return createEdgeArrayForPath(type, this.multi, direction, sourceData, target);
    }
    throw new InvalidArgumentsGraphError(`Graph.${name}: too many arguments (expecting 0, 1 or 2 and got ${arguments.length}).`);
  };
}
function attachForEachEdge(Class, description) {
  const { name, type, direction } = description;
  const forEachName = "forEach" + name[0].toUpperCase() + name.slice(1, -1);
  Class.prototype[forEachName] = function(source, target, callback) {
    if (type !== "mixed" && this.type !== "mixed" && type !== this.type)
      return;
    if (arguments.length === 1) {
      callback = source;
      return forEachEdge(false, this, type, callback);
    }
    if (arguments.length === 2) {
      source = "" + source;
      callback = target;
      const nodeData = this._nodes.get(source);
      if (typeof nodeData === "undefined")
        throw new NotFoundGraphError(`Graph.${forEachName}: could not find the "${source}" node in the graph.`);
      return forEachEdgeForNode(false, this.multi, type === "mixed" ? this.type : type, direction, nodeData, callback);
    }
    if (arguments.length === 3) {
      source = "" + source;
      target = "" + target;
      const sourceData = this._nodes.get(source);
      if (!sourceData)
        throw new NotFoundGraphError(`Graph.${forEachName}:  could not find the "${source}" source node in the graph.`);
      if (!this._nodes.has(target))
        throw new NotFoundGraphError(`Graph.${forEachName}:  could not find the "${target}" target node in the graph.`);
      return forEachEdgeForPath(false, type, this.multi, direction, sourceData, target, callback);
    }
    throw new InvalidArgumentsGraphError(`Graph.${forEachName}: too many arguments (expecting 1, 2 or 3 and got ${arguments.length}).`);
  };
  const mapName = "map" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[mapName] = function() {
    const args = Array.prototype.slice.call(arguments);
    const callback = args.pop();
    let result;
    if (args.length === 0) {
      let length = 0;
      if (type !== "directed")
        length += this.undirectedSize;
      if (type !== "undirected")
        length += this.directedSize;
      result = new Array(length);
      let i = 0;
      args.push((e, ea, s, t, sa, ta, u) => {
        result[i++] = callback(e, ea, s, t, sa, ta, u);
      });
    } else {
      result = [];
      args.push((e, ea, s, t, sa, ta, u) => {
        result.push(callback(e, ea, s, t, sa, ta, u));
      });
    }
    this[forEachName].apply(this, args);
    return result;
  };
  const filterName = "filter" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[filterName] = function() {
    const args = Array.prototype.slice.call(arguments);
    const callback = args.pop();
    const result = [];
    args.push((e, ea, s, t, sa, ta, u) => {
      if (callback(e, ea, s, t, sa, ta, u))
        result.push(e);
    });
    this[forEachName].apply(this, args);
    return result;
  };
  const reduceName = "reduce" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[reduceName] = function() {
    let args = Array.prototype.slice.call(arguments);
    if (args.length < 2 || args.length > 4) {
      throw new InvalidArgumentsGraphError(`Graph.${reduceName}: invalid number of arguments (expecting 2, 3 or 4 and got ${args.length}).`);
    }
    if (typeof args[args.length - 1] === "function" && typeof args[args.length - 2] !== "function") {
      throw new InvalidArgumentsGraphError(`Graph.${reduceName}: missing initial value. You must provide it because the callback takes more than one argument and we cannot infer the initial value from the first iteration, as you could with a simple array.`);
    }
    let callback;
    let initialValue;
    if (args.length === 2) {
      callback = args[0];
      initialValue = args[1];
      args = [];
    } else if (args.length === 3) {
      callback = args[1];
      initialValue = args[2];
      args = [args[0]];
    } else if (args.length === 4) {
      callback = args[2];
      initialValue = args[3];
      args = [args[0], args[1]];
    }
    let accumulator = initialValue;
    args.push((e, ea, s, t, sa, ta, u) => {
      accumulator = callback(accumulator, e, ea, s, t, sa, ta, u);
    });
    this[forEachName].apply(this, args);
    return accumulator;
  };
}
function attachFindEdge(Class, description) {
  const { name, type, direction } = description;
  const findEdgeName = "find" + name[0].toUpperCase() + name.slice(1, -1);
  Class.prototype[findEdgeName] = function(source, target, callback) {
    if (type !== "mixed" && this.type !== "mixed" && type !== this.type)
      return false;
    if (arguments.length === 1) {
      callback = source;
      return forEachEdge(true, this, type, callback);
    }
    if (arguments.length === 2) {
      source = "" + source;
      callback = target;
      const nodeData = this._nodes.get(source);
      if (typeof nodeData === "undefined")
        throw new NotFoundGraphError(`Graph.${findEdgeName}: could not find the "${source}" node in the graph.`);
      return forEachEdgeForNode(true, this.multi, type === "mixed" ? this.type : type, direction, nodeData, callback);
    }
    if (arguments.length === 3) {
      source = "" + source;
      target = "" + target;
      const sourceData = this._nodes.get(source);
      if (!sourceData)
        throw new NotFoundGraphError(`Graph.${findEdgeName}:  could not find the "${source}" source node in the graph.`);
      if (!this._nodes.has(target))
        throw new NotFoundGraphError(`Graph.${findEdgeName}:  could not find the "${target}" target node in the graph.`);
      return forEachEdgeForPath(true, type, this.multi, direction, sourceData, target, callback);
    }
    throw new InvalidArgumentsGraphError(`Graph.${findEdgeName}: too many arguments (expecting 1, 2 or 3 and got ${arguments.length}).`);
  };
  const someName = "some" + name[0].toUpperCase() + name.slice(1, -1);
  Class.prototype[someName] = function() {
    const args = Array.prototype.slice.call(arguments);
    const callback = args.pop();
    args.push((e, ea, s, t, sa, ta, u) => {
      return callback(e, ea, s, t, sa, ta, u);
    });
    const found = this[findEdgeName].apply(this, args);
    if (found)
      return true;
    return false;
  };
  const everyName = "every" + name[0].toUpperCase() + name.slice(1, -1);
  Class.prototype[everyName] = function() {
    const args = Array.prototype.slice.call(arguments);
    const callback = args.pop();
    args.push((e, ea, s, t, sa, ta, u) => {
      return !callback(e, ea, s, t, sa, ta, u);
    });
    const found = this[findEdgeName].apply(this, args);
    if (found)
      return false;
    return true;
  };
}
function attachEdgeIteratorCreator(Class, description) {
  const { name: originalName, type, direction } = description;
  const name = originalName.slice(0, -1) + "Entries";
  Class.prototype[name] = function(source, target) {
    if (type !== "mixed" && this.type !== "mixed" && type !== this.type)
      return emptyIterator();
    if (!arguments.length)
      return createEdgeIterator(this, type);
    if (arguments.length === 1) {
      source = "" + source;
      const sourceData = this._nodes.get(source);
      if (!sourceData)
        throw new NotFoundGraphError(`Graph.${name}: could not find the "${source}" node in the graph.`);
      return createEdgeIteratorForNode(type, direction, sourceData);
    }
    if (arguments.length === 2) {
      source = "" + source;
      target = "" + target;
      const sourceData = this._nodes.get(source);
      if (!sourceData)
        throw new NotFoundGraphError(`Graph.${name}:  could not find the "${source}" source node in the graph.`);
      if (!this._nodes.has(target))
        throw new NotFoundGraphError(`Graph.${name}:  could not find the "${target}" target node in the graph.`);
      return createEdgeIteratorForPath(type, direction, sourceData, target);
    }
    throw new InvalidArgumentsGraphError(`Graph.${name}: too many arguments (expecting 0, 1 or 2 and got ${arguments.length}).`);
  };
}
function attachEdgeIterationMethods(Graph) {
  EDGES_ITERATION.forEach((description) => {
    attachEdgeArrayCreator(Graph, description);
    attachForEachEdge(Graph, description);
    attachFindEdge(Graph, description);
    attachEdgeIteratorCreator(Graph, description);
  });
}
var NEIGHBORS_ITERATION = [
  {
    name: "neighbors",
    type: "mixed"
  },
  {
    name: "inNeighbors",
    type: "directed",
    direction: "in"
  },
  {
    name: "outNeighbors",
    type: "directed",
    direction: "out"
  },
  {
    name: "inboundNeighbors",
    type: "mixed",
    direction: "in"
  },
  {
    name: "outboundNeighbors",
    type: "mixed",
    direction: "out"
  },
  {
    name: "directedNeighbors",
    type: "directed"
  },
  {
    name: "undirectedNeighbors",
    type: "undirected"
  }
];
function CompositeSetWrapper() {
  this.A = null;
  this.B = null;
}
CompositeSetWrapper.prototype.wrap = function(set) {
  if (this.A === null)
    this.A = set;
  else if (this.B === null)
    this.B = set;
};
CompositeSetWrapper.prototype.has = function(key) {
  if (this.A !== null && key in this.A)
    return true;
  if (this.B !== null && key in this.B)
    return true;
  return false;
};
function forEachInObjectOnce(breakable, visited, nodeData, object, callback) {
  for (const k in object) {
    const edgeData = object[k];
    const sourceData = edgeData.source;
    const targetData = edgeData.target;
    const neighborData = sourceData === nodeData ? targetData : sourceData;
    if (visited && visited.has(neighborData.key))
      continue;
    const shouldBreak = callback(neighborData.key, neighborData.attributes);
    if (breakable && shouldBreak)
      return neighborData.key;
  }
  return;
}
function forEachNeighbor(breakable, type, direction, nodeData, callback) {
  if (type !== "mixed") {
    if (type === "undirected")
      return forEachInObjectOnce(breakable, null, nodeData, nodeData.undirected, callback);
    if (typeof direction === "string")
      return forEachInObjectOnce(breakable, null, nodeData, nodeData[direction], callback);
  }
  const visited = new CompositeSetWrapper;
  let found;
  if (type !== "undirected") {
    if (direction !== "out") {
      found = forEachInObjectOnce(breakable, null, nodeData, nodeData.in, callback);
      if (breakable && found)
        return found;
      visited.wrap(nodeData.in);
    }
    if (direction !== "in") {
      found = forEachInObjectOnce(breakable, visited, nodeData, nodeData.out, callback);
      if (breakable && found)
        return found;
      visited.wrap(nodeData.out);
    }
  }
  if (type !== "directed") {
    found = forEachInObjectOnce(breakable, visited, nodeData, nodeData.undirected, callback);
    if (breakable && found)
      return found;
  }
  return;
}
function createNeighborArrayForNode(type, direction, nodeData) {
  if (type !== "mixed") {
    if (type === "undirected")
      return Object.keys(nodeData.undirected);
    if (typeof direction === "string")
      return Object.keys(nodeData[direction]);
  }
  const neighbors = [];
  forEachNeighbor(false, type, direction, nodeData, function(key) {
    neighbors.push(key);
  });
  return neighbors;
}
function createDedupedObjectIterator(visited, nodeData, object) {
  const keys = Object.keys(object);
  const l = keys.length;
  let i = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      let neighborData = null;
      do {
        if (i >= l) {
          if (visited)
            visited.wrap(object);
          return { done: true };
        }
        const edgeData = object[keys[i++]];
        const sourceData = edgeData.source;
        const targetData = edgeData.target;
        neighborData = sourceData === nodeData ? targetData : sourceData;
        if (visited && visited.has(neighborData.key)) {
          neighborData = null;
          continue;
        }
      } while (neighborData === null);
      return {
        done: false,
        value: { neighbor: neighborData.key, attributes: neighborData.attributes }
      };
    }
  };
}
function createNeighborIterator(type, direction, nodeData) {
  if (type !== "mixed") {
    if (type === "undirected")
      return createDedupedObjectIterator(null, nodeData, nodeData.undirected);
    if (typeof direction === "string")
      return createDedupedObjectIterator(null, nodeData, nodeData[direction]);
  }
  let iterator = emptyIterator();
  const visited = new CompositeSetWrapper;
  if (type !== "undirected") {
    if (direction !== "out") {
      iterator = chain(iterator, createDedupedObjectIterator(visited, nodeData, nodeData.in));
    }
    if (direction !== "in") {
      iterator = chain(iterator, createDedupedObjectIterator(visited, nodeData, nodeData.out));
    }
  }
  if (type !== "directed") {
    iterator = chain(iterator, createDedupedObjectIterator(visited, nodeData, nodeData.undirected));
  }
  return iterator;
}
function attachNeighborArrayCreator(Class, description) {
  const { name, type, direction } = description;
  Class.prototype[name] = function(node) {
    if (type !== "mixed" && this.type !== "mixed" && type !== this.type)
      return [];
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (typeof nodeData === "undefined")
      throw new NotFoundGraphError(`Graph.${name}: could not find the "${node}" node in the graph.`);
    return createNeighborArrayForNode(type === "mixed" ? this.type : type, direction, nodeData);
  };
}
function attachForEachNeighbor(Class, description) {
  const { name, type, direction } = description;
  const forEachName = "forEach" + name[0].toUpperCase() + name.slice(1, -1);
  Class.prototype[forEachName] = function(node, callback) {
    if (type !== "mixed" && this.type !== "mixed" && type !== this.type)
      return;
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (typeof nodeData === "undefined")
      throw new NotFoundGraphError(`Graph.${forEachName}: could not find the "${node}" node in the graph.`);
    forEachNeighbor(false, type === "mixed" ? this.type : type, direction, nodeData, callback);
  };
  const mapName = "map" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[mapName] = function(node, callback) {
    const result = [];
    this[forEachName](node, (n, a) => {
      result.push(callback(n, a));
    });
    return result;
  };
  const filterName = "filter" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[filterName] = function(node, callback) {
    const result = [];
    this[forEachName](node, (n, a) => {
      if (callback(n, a))
        result.push(n);
    });
    return result;
  };
  const reduceName = "reduce" + name[0].toUpperCase() + name.slice(1);
  Class.prototype[reduceName] = function(node, callback, initialValue) {
    if (arguments.length < 3)
      throw new InvalidArgumentsGraphError(`Graph.${reduceName}: missing initial value. You must provide it because the callback takes more than one argument and we cannot infer the initial value from the first iteration, as you could with a simple array.`);
    let accumulator = initialValue;
    this[forEachName](node, (n, a) => {
      accumulator = callback(accumulator, n, a);
    });
    return accumulator;
  };
}
function attachFindNeighbor(Class, description) {
  const { name, type, direction } = description;
  const capitalizedSingular = name[0].toUpperCase() + name.slice(1, -1);
  const findName = "find" + capitalizedSingular;
  Class.prototype[findName] = function(node, callback) {
    if (type !== "mixed" && this.type !== "mixed" && type !== this.type)
      return;
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (typeof nodeData === "undefined")
      throw new NotFoundGraphError(`Graph.${findName}: could not find the "${node}" node in the graph.`);
    return forEachNeighbor(true, type === "mixed" ? this.type : type, direction, nodeData, callback);
  };
  const someName = "some" + capitalizedSingular;
  Class.prototype[someName] = function(node, callback) {
    const found = this[findName](node, callback);
    if (found)
      return true;
    return false;
  };
  const everyName = "every" + capitalizedSingular;
  Class.prototype[everyName] = function(node, callback) {
    const found = this[findName](node, (n, a) => {
      return !callback(n, a);
    });
    if (found)
      return false;
    return true;
  };
}
function attachNeighborIteratorCreator(Class, description) {
  const { name, type, direction } = description;
  const iteratorName = name.slice(0, -1) + "Entries";
  Class.prototype[iteratorName] = function(node) {
    if (type !== "mixed" && this.type !== "mixed" && type !== this.type)
      return emptyIterator();
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (typeof nodeData === "undefined")
      throw new NotFoundGraphError(`Graph.${iteratorName}: could not find the "${node}" node in the graph.`);
    return createNeighborIterator(type === "mixed" ? this.type : type, direction, nodeData);
  };
}
function attachNeighborIterationMethods(Graph) {
  NEIGHBORS_ITERATION.forEach((description) => {
    attachNeighborArrayCreator(Graph, description);
    attachForEachNeighbor(Graph, description);
    attachFindNeighbor(Graph, description);
    attachNeighborIteratorCreator(Graph, description);
  });
}
function forEachAdjacency(breakable, assymetric, disconnectedNodes, graph, callback) {
  const iterator = graph._nodes.values();
  const type = graph.type;
  let step, sourceData, neighbor, adj, edgeData, targetData, shouldBreak;
  while (step = iterator.next(), step.done !== true) {
    let hasEdges = false;
    sourceData = step.value;
    if (type !== "undirected") {
      adj = sourceData.out;
      for (neighbor in adj) {
        edgeData = adj[neighbor];
        do {
          targetData = edgeData.target;
          hasEdges = true;
          shouldBreak = callback(sourceData.key, targetData.key, sourceData.attributes, targetData.attributes, edgeData.key, edgeData.attributes, edgeData.undirected);
          if (breakable && shouldBreak)
            return edgeData;
          edgeData = edgeData.next;
        } while (edgeData);
      }
    }
    if (type !== "directed") {
      adj = sourceData.undirected;
      for (neighbor in adj) {
        if (assymetric && sourceData.key > neighbor)
          continue;
        edgeData = adj[neighbor];
        do {
          targetData = edgeData.target;
          if (targetData.key !== neighbor)
            targetData = edgeData.source;
          hasEdges = true;
          shouldBreak = callback(sourceData.key, targetData.key, sourceData.attributes, targetData.attributes, edgeData.key, edgeData.attributes, edgeData.undirected);
          if (breakable && shouldBreak)
            return edgeData;
          edgeData = edgeData.next;
        } while (edgeData);
      }
    }
    if (disconnectedNodes && !hasEdges) {
      shouldBreak = callback(sourceData.key, null, sourceData.attributes, null, null, null, null);
      if (breakable && shouldBreak)
        return null;
    }
  }
  return;
}
function serializeNode(key, data) {
  const serialized = { key };
  if (!isEmpty(data.attributes))
    serialized.attributes = assign({}, data.attributes);
  return serialized;
}
function serializeEdge(type, key, data) {
  const serialized = {
    key,
    source: data.source.key,
    target: data.target.key
  };
  if (!isEmpty(data.attributes))
    serialized.attributes = assign({}, data.attributes);
  if (type === "mixed" && data.undirected)
    serialized.undirected = true;
  return serialized;
}
function validateSerializedNode(value) {
  if (!isPlainObject(value))
    throw new InvalidArgumentsGraphError('Graph.import: invalid serialized node. A serialized node should be a plain object with at least a "key" property.');
  if (!("key" in value))
    throw new InvalidArgumentsGraphError("Graph.import: serialized node is missing its key.");
  if ("attributes" in value && (!isPlainObject(value.attributes) || value.attributes === null))
    throw new InvalidArgumentsGraphError("Graph.import: invalid attributes. Attributes should be a plain object, null or omitted.");
}
function validateSerializedEdge(value) {
  if (!isPlainObject(value))
    throw new InvalidArgumentsGraphError('Graph.import: invalid serialized edge. A serialized edge should be a plain object with at least a "source" & "target" property.');
  if (!("source" in value))
    throw new InvalidArgumentsGraphError("Graph.import: serialized edge is missing its source.");
  if (!("target" in value))
    throw new InvalidArgumentsGraphError("Graph.import: serialized edge is missing its target.");
  if ("attributes" in value && (!isPlainObject(value.attributes) || value.attributes === null))
    throw new InvalidArgumentsGraphError("Graph.import: invalid attributes. Attributes should be a plain object, null or omitted.");
  if ("undirected" in value && typeof value.undirected !== "boolean")
    throw new InvalidArgumentsGraphError("Graph.import: invalid undirectedness information. Undirected should be boolean or omitted.");
}
var INSTANCE_ID = incrementalIdStartingFromRandomByte();
var TYPES = new Set(["directed", "undirected", "mixed"]);
var EMITTER_PROPS = new Set([
  "domain",
  "_events",
  "_eventsCount",
  "_maxListeners"
]);
var EDGE_ADD_METHODS = [
  {
    name: (verb) => `${verb}Edge`,
    generateKey: true
  },
  {
    name: (verb) => `${verb}DirectedEdge`,
    generateKey: true,
    type: "directed"
  },
  {
    name: (verb) => `${verb}UndirectedEdge`,
    generateKey: true,
    type: "undirected"
  },
  {
    name: (verb) => `${verb}EdgeWithKey`
  },
  {
    name: (verb) => `${verb}DirectedEdgeWithKey`,
    type: "directed"
  },
  {
    name: (verb) => `${verb}UndirectedEdgeWithKey`,
    type: "undirected"
  }
];
var DEFAULTS = {
  allowSelfLoops: true,
  multi: false,
  type: "mixed"
};
function addNode(graph, node, attributes) {
  if (attributes && !isPlainObject(attributes))
    throw new InvalidArgumentsGraphError(`Graph.addNode: invalid attributes. Expecting an object but got "${attributes}"`);
  node = "" + node;
  attributes = attributes || {};
  if (graph._nodes.has(node))
    throw new UsageGraphError(`Graph.addNode: the "${node}" node already exist in the graph.`);
  const data = new graph.NodeDataClass(node, attributes);
  graph._nodes.set(node, data);
  graph.emit("nodeAdded", {
    key: node,
    attributes
  });
  return data;
}
function unsafeAddNode(graph, node, attributes) {
  const data = new graph.NodeDataClass(node, attributes);
  graph._nodes.set(node, data);
  graph.emit("nodeAdded", {
    key: node,
    attributes
  });
  return data;
}
function addEdge(graph, name, mustGenerateKey, undirected, edge, source, target, attributes) {
  if (!undirected && graph.type === "undirected")
    throw new UsageGraphError(`Graph.${name}: you cannot add a directed edge to an undirected graph. Use the #.addEdge or #.addUndirectedEdge instead.`);
  if (undirected && graph.type === "directed")
    throw new UsageGraphError(`Graph.${name}: you cannot add an undirected edge to a directed graph. Use the #.addEdge or #.addDirectedEdge instead.`);
  if (attributes && !isPlainObject(attributes))
    throw new InvalidArgumentsGraphError(`Graph.${name}: invalid attributes. Expecting an object but got "${attributes}"`);
  source = "" + source;
  target = "" + target;
  attributes = attributes || {};
  if (!graph.allowSelfLoops && source === target)
    throw new UsageGraphError(`Graph.${name}: source & target are the same ("${source}"), thus creating a loop explicitly forbidden by this graph 'allowSelfLoops' option set to false.`);
  const sourceData = graph._nodes.get(source), targetData = graph._nodes.get(target);
  if (!sourceData)
    throw new NotFoundGraphError(`Graph.${name}: source node "${source}" not found.`);
  if (!targetData)
    throw new NotFoundGraphError(`Graph.${name}: target node "${target}" not found.`);
  const eventData = {
    key: null,
    undirected,
    source,
    target,
    attributes
  };
  if (mustGenerateKey) {
    edge = graph._edgeKeyGenerator();
  } else {
    edge = "" + edge;
    if (graph._edges.has(edge))
      throw new UsageGraphError(`Graph.${name}: the "${edge}" edge already exists in the graph.`);
  }
  if (!graph.multi && (undirected ? typeof sourceData.undirected[target] !== "undefined" : typeof sourceData.out[target] !== "undefined")) {
    throw new UsageGraphError(`Graph.${name}: an edge linking "${source}" to "${target}" already exists. If you really want to add multiple edges linking those nodes, you should create a multi graph by using the 'multi' option.`);
  }
  const edgeData = new EdgeData(undirected, edge, sourceData, targetData, attributes);
  graph._edges.set(edge, edgeData);
  const isSelfLoop = source === target;
  if (undirected) {
    sourceData.undirectedDegree++;
    targetData.undirectedDegree++;
    if (isSelfLoop) {
      sourceData.undirectedLoops++;
      graph._undirectedSelfLoopCount++;
    }
  } else {
    sourceData.outDegree++;
    targetData.inDegree++;
    if (isSelfLoop) {
      sourceData.directedLoops++;
      graph._directedSelfLoopCount++;
    }
  }
  if (graph.multi)
    edgeData.attachMulti();
  else
    edgeData.attach();
  if (undirected)
    graph._undirectedSize++;
  else
    graph._directedSize++;
  eventData.key = edge;
  graph.emit("edgeAdded", eventData);
  return edge;
}
function mergeEdge(graph, name, mustGenerateKey, undirected, edge, source, target, attributes, asUpdater) {
  if (!undirected && graph.type === "undirected")
    throw new UsageGraphError(`Graph.${name}: you cannot merge/update a directed edge to an undirected graph. Use the #.mergeEdge/#.updateEdge or #.addUndirectedEdge instead.`);
  if (undirected && graph.type === "directed")
    throw new UsageGraphError(`Graph.${name}: you cannot merge/update an undirected edge to a directed graph. Use the #.mergeEdge/#.updateEdge or #.addDirectedEdge instead.`);
  if (attributes) {
    if (asUpdater) {
      if (typeof attributes !== "function")
        throw new InvalidArgumentsGraphError(`Graph.${name}: invalid updater function. Expecting a function but got "${attributes}"`);
    } else {
      if (!isPlainObject(attributes))
        throw new InvalidArgumentsGraphError(`Graph.${name}: invalid attributes. Expecting an object but got "${attributes}"`);
    }
  }
  source = "" + source;
  target = "" + target;
  let updater;
  if (asUpdater) {
    updater = attributes;
    attributes = undefined;
  }
  if (!graph.allowSelfLoops && source === target)
    throw new UsageGraphError(`Graph.${name}: source & target are the same ("${source}"), thus creating a loop explicitly forbidden by this graph 'allowSelfLoops' option set to false.`);
  let sourceData = graph._nodes.get(source);
  let targetData = graph._nodes.get(target);
  let edgeData;
  let alreadyExistingEdgeData;
  if (!mustGenerateKey) {
    edgeData = graph._edges.get(edge);
    if (edgeData) {
      if (edgeData.source.key !== source || edgeData.target.key !== target) {
        if (!undirected || edgeData.source.key !== target || edgeData.target.key !== source) {
          throw new UsageGraphError(`Graph.${name}: inconsistency detected when attempting to merge the "${edge}" edge with "${source}" source & "${target}" target vs. ("${edgeData.source.key}", "${edgeData.target.key}").`);
        }
      }
      alreadyExistingEdgeData = edgeData;
    }
  }
  if (!alreadyExistingEdgeData && !graph.multi && sourceData) {
    alreadyExistingEdgeData = undirected ? sourceData.undirected[target] : sourceData.out[target];
  }
  if (alreadyExistingEdgeData) {
    const info = [alreadyExistingEdgeData.key, false, false, false];
    if (asUpdater ? !updater : !attributes)
      return info;
    if (asUpdater) {
      const oldAttributes = alreadyExistingEdgeData.attributes;
      alreadyExistingEdgeData.attributes = updater(oldAttributes);
      graph.emit("edgeAttributesUpdated", {
        type: "replace",
        key: alreadyExistingEdgeData.key,
        attributes: alreadyExistingEdgeData.attributes
      });
    } else {
      assign(alreadyExistingEdgeData.attributes, attributes);
      graph.emit("edgeAttributesUpdated", {
        type: "merge",
        key: alreadyExistingEdgeData.key,
        attributes: alreadyExistingEdgeData.attributes,
        data: attributes
      });
    }
    return info;
  }
  attributes = attributes || {};
  if (asUpdater && updater)
    attributes = updater(attributes);
  const eventData = {
    key: null,
    undirected,
    source,
    target,
    attributes
  };
  if (mustGenerateKey) {
    edge = graph._edgeKeyGenerator();
  } else {
    edge = "" + edge;
    if (graph._edges.has(edge))
      throw new UsageGraphError(`Graph.${name}: the "${edge}" edge already exists in the graph.`);
  }
  let sourceWasAdded = false;
  let targetWasAdded = false;
  if (!sourceData) {
    sourceData = unsafeAddNode(graph, source, {});
    sourceWasAdded = true;
    if (source === target) {
      targetData = sourceData;
      targetWasAdded = true;
    }
  }
  if (!targetData) {
    targetData = unsafeAddNode(graph, target, {});
    targetWasAdded = true;
  }
  edgeData = new EdgeData(undirected, edge, sourceData, targetData, attributes);
  graph._edges.set(edge, edgeData);
  const isSelfLoop = source === target;
  if (undirected) {
    sourceData.undirectedDegree++;
    targetData.undirectedDegree++;
    if (isSelfLoop) {
      sourceData.undirectedLoops++;
      graph._undirectedSelfLoopCount++;
    }
  } else {
    sourceData.outDegree++;
    targetData.inDegree++;
    if (isSelfLoop) {
      sourceData.directedLoops++;
      graph._directedSelfLoopCount++;
    }
  }
  if (graph.multi)
    edgeData.attachMulti();
  else
    edgeData.attach();
  if (undirected)
    graph._undirectedSize++;
  else
    graph._directedSize++;
  eventData.key = edge;
  graph.emit("edgeAdded", eventData);
  return [edge, true, sourceWasAdded, targetWasAdded];
}
function dropEdgeFromData(graph, edgeData) {
  graph._edges.delete(edgeData.key);
  const { source: sourceData, target: targetData, attributes } = edgeData;
  const undirected = edgeData.undirected;
  const isSelfLoop = sourceData === targetData;
  if (undirected) {
    sourceData.undirectedDegree--;
    targetData.undirectedDegree--;
    if (isSelfLoop) {
      sourceData.undirectedLoops--;
      graph._undirectedSelfLoopCount--;
    }
  } else {
    sourceData.outDegree--;
    targetData.inDegree--;
    if (isSelfLoop) {
      sourceData.directedLoops--;
      graph._directedSelfLoopCount--;
    }
  }
  if (graph.multi)
    edgeData.detachMulti();
  else
    edgeData.detach();
  if (undirected)
    graph._undirectedSize--;
  else
    graph._directedSize--;
  graph.emit("edgeDropped", {
    key: edgeData.key,
    attributes,
    source: sourceData.key,
    target: targetData.key,
    undirected
  });
}

class Graph extends EventEmitter {
  constructor(options) {
    super();
    options = assign({}, DEFAULTS, options);
    if (typeof options.multi !== "boolean")
      throw new InvalidArgumentsGraphError(`Graph.constructor: invalid 'multi' option. Expecting a boolean but got "${options.multi}".`);
    if (!TYPES.has(options.type))
      throw new InvalidArgumentsGraphError(`Graph.constructor: invalid 'type' option. Should be one of "mixed", "directed" or "undirected" but got "${options.type}".`);
    if (typeof options.allowSelfLoops !== "boolean")
      throw new InvalidArgumentsGraphError(`Graph.constructor: invalid 'allowSelfLoops' option. Expecting a boolean but got "${options.allowSelfLoops}".`);
    const NodeDataClass = options.type === "mixed" ? MixedNodeData : options.type === "directed" ? DirectedNodeData : UndirectedNodeData;
    privateProperty(this, "NodeDataClass", NodeDataClass);
    const instancePrefix = "geid_" + INSTANCE_ID() + "_";
    let edgeId = 0;
    const edgeKeyGenerator = () => {
      let availableEdgeKey;
      do {
        availableEdgeKey = instancePrefix + edgeId++;
      } while (this._edges.has(availableEdgeKey));
      return availableEdgeKey;
    };
    privateProperty(this, "_attributes", {});
    privateProperty(this, "_nodes", new Map);
    privateProperty(this, "_edges", new Map);
    privateProperty(this, "_directedSize", 0);
    privateProperty(this, "_undirectedSize", 0);
    privateProperty(this, "_directedSelfLoopCount", 0);
    privateProperty(this, "_undirectedSelfLoopCount", 0);
    privateProperty(this, "_edgeKeyGenerator", edgeKeyGenerator);
    privateProperty(this, "_options", options);
    EMITTER_PROPS.forEach((prop) => privateProperty(this, prop, this[prop]));
    readOnlyProperty(this, "order", () => this._nodes.size);
    readOnlyProperty(this, "size", () => this._edges.size);
    readOnlyProperty(this, "directedSize", () => this._directedSize);
    readOnlyProperty(this, "undirectedSize", () => this._undirectedSize);
    readOnlyProperty(this, "selfLoopCount", () => this._directedSelfLoopCount + this._undirectedSelfLoopCount);
    readOnlyProperty(this, "directedSelfLoopCount", () => this._directedSelfLoopCount);
    readOnlyProperty(this, "undirectedSelfLoopCount", () => this._undirectedSelfLoopCount);
    readOnlyProperty(this, "multi", this._options.multi);
    readOnlyProperty(this, "type", this._options.type);
    readOnlyProperty(this, "allowSelfLoops", this._options.allowSelfLoops);
    readOnlyProperty(this, "implementation", () => "graphology");
  }
  _resetInstanceCounters() {
    this._directedSize = 0;
    this._undirectedSize = 0;
    this._directedSelfLoopCount = 0;
    this._undirectedSelfLoopCount = 0;
  }
  hasNode(node) {
    return this._nodes.has("" + node);
  }
  hasDirectedEdge(source, target) {
    if (this.type === "undirected")
      return false;
    if (arguments.length === 1) {
      const edge = "" + source;
      const edgeData = this._edges.get(edge);
      return !!edgeData && !edgeData.undirected;
    } else if (arguments.length === 2) {
      source = "" + source;
      target = "" + target;
      const nodeData = this._nodes.get(source);
      if (!nodeData)
        return false;
      return nodeData.out.hasOwnProperty(target);
    }
    throw new InvalidArgumentsGraphError(`Graph.hasDirectedEdge: invalid arity (${arguments.length}, instead of 1 or 2). You can either ask for an edge id or for the existence of an edge between a source & a target.`);
  }
  hasUndirectedEdge(source, target) {
    if (this.type === "directed")
      return false;
    if (arguments.length === 1) {
      const edge = "" + source;
      const edgeData = this._edges.get(edge);
      return !!edgeData && edgeData.undirected;
    } else if (arguments.length === 2) {
      source = "" + source;
      target = "" + target;
      const nodeData = this._nodes.get(source);
      if (!nodeData)
        return false;
      return nodeData.undirected.hasOwnProperty(target);
    }
    throw new InvalidArgumentsGraphError(`Graph.hasDirectedEdge: invalid arity (${arguments.length}, instead of 1 or 2). You can either ask for an edge id or for the existence of an edge between a source & a target.`);
  }
  hasEdge(source, target) {
    if (arguments.length === 1) {
      const edge = "" + source;
      return this._edges.has(edge);
    } else if (arguments.length === 2) {
      source = "" + source;
      target = "" + target;
      const nodeData = this._nodes.get(source);
      if (!nodeData)
        return false;
      return typeof nodeData.out !== "undefined" && nodeData.out.hasOwnProperty(target) || typeof nodeData.undirected !== "undefined" && nodeData.undirected.hasOwnProperty(target);
    }
    throw new InvalidArgumentsGraphError(`Graph.hasEdge: invalid arity (${arguments.length}, instead of 1 or 2). You can either ask for an edge id or for the existence of an edge between a source & a target.`);
  }
  directedEdge(source, target) {
    if (this.type === "undirected")
      return;
    source = "" + source;
    target = "" + target;
    if (this.multi)
      throw new UsageGraphError("Graph.directedEdge: this method is irrelevant with multigraphs since there might be multiple edges between source & target. See #.directedEdges instead.");
    const sourceData = this._nodes.get(source);
    if (!sourceData)
      throw new NotFoundGraphError(`Graph.directedEdge: could not find the "${source}" source node in the graph.`);
    if (!this._nodes.has(target))
      throw new NotFoundGraphError(`Graph.directedEdge: could not find the "${target}" target node in the graph.`);
    const edgeData = sourceData.out && sourceData.out[target] || undefined;
    if (edgeData)
      return edgeData.key;
  }
  undirectedEdge(source, target) {
    if (this.type === "directed")
      return;
    source = "" + source;
    target = "" + target;
    if (this.multi)
      throw new UsageGraphError("Graph.undirectedEdge: this method is irrelevant with multigraphs since there might be multiple edges between source & target. See #.undirectedEdges instead.");
    const sourceData = this._nodes.get(source);
    if (!sourceData)
      throw new NotFoundGraphError(`Graph.undirectedEdge: could not find the "${source}" source node in the graph.`);
    if (!this._nodes.has(target))
      throw new NotFoundGraphError(`Graph.undirectedEdge: could not find the "${target}" target node in the graph.`);
    const edgeData = sourceData.undirected && sourceData.undirected[target] || undefined;
    if (edgeData)
      return edgeData.key;
  }
  edge(source, target) {
    if (this.multi)
      throw new UsageGraphError("Graph.edge: this method is irrelevant with multigraphs since there might be multiple edges between source & target. See #.edges instead.");
    source = "" + source;
    target = "" + target;
    const sourceData = this._nodes.get(source);
    if (!sourceData)
      throw new NotFoundGraphError(`Graph.edge: could not find the "${source}" source node in the graph.`);
    if (!this._nodes.has(target))
      throw new NotFoundGraphError(`Graph.edge: could not find the "${target}" target node in the graph.`);
    const edgeData = sourceData.out && sourceData.out[target] || sourceData.undirected && sourceData.undirected[target] || undefined;
    if (edgeData)
      return edgeData.key;
  }
  areDirectedNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.areDirectedNeighbors: could not find the "${node}" node in the graph.`);
    if (this.type === "undirected")
      return false;
    return neighbor in nodeData.in || neighbor in nodeData.out;
  }
  areOutNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.areOutNeighbors: could not find the "${node}" node in the graph.`);
    if (this.type === "undirected")
      return false;
    return neighbor in nodeData.out;
  }
  areInNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.areInNeighbors: could not find the "${node}" node in the graph.`);
    if (this.type === "undirected")
      return false;
    return neighbor in nodeData.in;
  }
  areUndirectedNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.areUndirectedNeighbors: could not find the "${node}" node in the graph.`);
    if (this.type === "directed")
      return false;
    return neighbor in nodeData.undirected;
  }
  areNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.areNeighbors: could not find the "${node}" node in the graph.`);
    if (this.type !== "undirected") {
      if (neighbor in nodeData.in || neighbor in nodeData.out)
        return true;
    }
    if (this.type !== "directed") {
      if (neighbor in nodeData.undirected)
        return true;
    }
    return false;
  }
  areInboundNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.areInboundNeighbors: could not find the "${node}" node in the graph.`);
    if (this.type !== "undirected") {
      if (neighbor in nodeData.in)
        return true;
    }
    if (this.type !== "directed") {
      if (neighbor in nodeData.undirected)
        return true;
    }
    return false;
  }
  areOutboundNeighbors(node, neighbor) {
    node = "" + node;
    neighbor = "" + neighbor;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.areOutboundNeighbors: could not find the "${node}" node in the graph.`);
    if (this.type !== "undirected") {
      if (neighbor in nodeData.out)
        return true;
    }
    if (this.type !== "directed") {
      if (neighbor in nodeData.undirected)
        return true;
    }
    return false;
  }
  inDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.inDegree: could not find the "${node}" node in the graph.`);
    if (this.type === "undirected")
      return 0;
    return nodeData.inDegree;
  }
  outDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.outDegree: could not find the "${node}" node in the graph.`);
    if (this.type === "undirected")
      return 0;
    return nodeData.outDegree;
  }
  directedDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.directedDegree: could not find the "${node}" node in the graph.`);
    if (this.type === "undirected")
      return 0;
    return nodeData.inDegree + nodeData.outDegree;
  }
  undirectedDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.undirectedDegree: could not find the "${node}" node in the graph.`);
    if (this.type === "directed")
      return 0;
    return nodeData.undirectedDegree;
  }
  inboundDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.inboundDegree: could not find the "${node}" node in the graph.`);
    let degree = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
    }
    if (this.type !== "undirected") {
      degree += nodeData.inDegree;
    }
    return degree;
  }
  outboundDegree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.outboundDegree: could not find the "${node}" node in the graph.`);
    let degree = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
    }
    if (this.type !== "undirected") {
      degree += nodeData.outDegree;
    }
    return degree;
  }
  degree(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.degree: could not find the "${node}" node in the graph.`);
    let degree = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
    }
    if (this.type !== "undirected") {
      degree += nodeData.inDegree + nodeData.outDegree;
    }
    return degree;
  }
  inDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.inDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`);
    if (this.type === "undirected")
      return 0;
    return nodeData.inDegree - nodeData.directedLoops;
  }
  outDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.outDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`);
    if (this.type === "undirected")
      return 0;
    return nodeData.outDegree - nodeData.directedLoops;
  }
  directedDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.directedDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`);
    if (this.type === "undirected")
      return 0;
    return nodeData.inDegree + nodeData.outDegree - nodeData.directedLoops * 2;
  }
  undirectedDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.undirectedDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`);
    if (this.type === "directed")
      return 0;
    return nodeData.undirectedDegree - nodeData.undirectedLoops * 2;
  }
  inboundDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.inboundDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`);
    let degree = 0;
    let loops = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
      loops += nodeData.undirectedLoops * 2;
    }
    if (this.type !== "undirected") {
      degree += nodeData.inDegree;
      loops += nodeData.directedLoops;
    }
    return degree - loops;
  }
  outboundDegreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.outboundDegreeWithoutSelfLoops: could not find the "${node}" node in the graph.`);
    let degree = 0;
    let loops = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
      loops += nodeData.undirectedLoops * 2;
    }
    if (this.type !== "undirected") {
      degree += nodeData.outDegree;
      loops += nodeData.directedLoops;
    }
    return degree - loops;
  }
  degreeWithoutSelfLoops(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.degreeWithoutSelfLoops: could not find the "${node}" node in the graph.`);
    let degree = 0;
    let loops = 0;
    if (this.type !== "directed") {
      degree += nodeData.undirectedDegree;
      loops += nodeData.undirectedLoops * 2;
    }
    if (this.type !== "undirected") {
      degree += nodeData.inDegree + nodeData.outDegree;
      loops += nodeData.directedLoops * 2;
    }
    return degree - loops;
  }
  source(edge) {
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(`Graph.source: could not find the "${edge}" edge in the graph.`);
    return data.source.key;
  }
  target(edge) {
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(`Graph.target: could not find the "${edge}" edge in the graph.`);
    return data.target.key;
  }
  extremities(edge) {
    edge = "" + edge;
    const edgeData = this._edges.get(edge);
    if (!edgeData)
      throw new NotFoundGraphError(`Graph.extremities: could not find the "${edge}" edge in the graph.`);
    return [edgeData.source.key, edgeData.target.key];
  }
  opposite(node, edge) {
    node = "" + node;
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(`Graph.opposite: could not find the "${edge}" edge in the graph.`);
    const source = data.source.key;
    const target = data.target.key;
    if (node === source)
      return target;
    if (node === target)
      return source;
    throw new NotFoundGraphError(`Graph.opposite: the "${node}" node is not attached to the "${edge}" edge (${source}, ${target}).`);
  }
  hasExtremity(edge, node) {
    edge = "" + edge;
    node = "" + node;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(`Graph.hasExtremity: could not find the "${edge}" edge in the graph.`);
    return data.source.key === node || data.target.key === node;
  }
  isUndirected(edge) {
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(`Graph.isUndirected: could not find the "${edge}" edge in the graph.`);
    return data.undirected;
  }
  isDirected(edge) {
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(`Graph.isDirected: could not find the "${edge}" edge in the graph.`);
    return !data.undirected;
  }
  isSelfLoop(edge) {
    edge = "" + edge;
    const data = this._edges.get(edge);
    if (!data)
      throw new NotFoundGraphError(`Graph.isSelfLoop: could not find the "${edge}" edge in the graph.`);
    return data.source === data.target;
  }
  addNode(node, attributes) {
    const nodeData = addNode(this, node, attributes);
    return nodeData.key;
  }
  mergeNode(node, attributes) {
    if (attributes && !isPlainObject(attributes))
      throw new InvalidArgumentsGraphError(`Graph.mergeNode: invalid attributes. Expecting an object but got "${attributes}"`);
    node = "" + node;
    attributes = attributes || {};
    let data = this._nodes.get(node);
    if (data) {
      if (attributes) {
        assign(data.attributes, attributes);
        this.emit("nodeAttributesUpdated", {
          type: "merge",
          key: node,
          attributes: data.attributes,
          data: attributes
        });
      }
      return [node, false];
    }
    data = new this.NodeDataClass(node, attributes);
    this._nodes.set(node, data);
    this.emit("nodeAdded", {
      key: node,
      attributes
    });
    return [node, true];
  }
  updateNode(node, updater) {
    if (updater && typeof updater !== "function")
      throw new InvalidArgumentsGraphError(`Graph.updateNode: invalid updater function. Expecting a function but got "${updater}"`);
    node = "" + node;
    let data = this._nodes.get(node);
    if (data) {
      if (updater) {
        const oldAttributes = data.attributes;
        data.attributes = updater(oldAttributes);
        this.emit("nodeAttributesUpdated", {
          type: "replace",
          key: node,
          attributes: data.attributes
        });
      }
      return [node, false];
    }
    const attributes = updater ? updater({}) : {};
    data = new this.NodeDataClass(node, attributes);
    this._nodes.set(node, data);
    this.emit("nodeAdded", {
      key: node,
      attributes
    });
    return [node, true];
  }
  dropNode(node) {
    node = "" + node;
    const nodeData = this._nodes.get(node);
    if (!nodeData)
      throw new NotFoundGraphError(`Graph.dropNode: could not find the "${node}" node in the graph.`);
    let edgeData;
    if (this.type !== "undirected") {
      for (const neighbor in nodeData.out) {
        edgeData = nodeData.out[neighbor];
        do {
          dropEdgeFromData(this, edgeData);
          edgeData = edgeData.next;
        } while (edgeData);
      }
      for (const neighbor in nodeData.in) {
        edgeData = nodeData.in[neighbor];
        do {
          dropEdgeFromData(this, edgeData);
          edgeData = edgeData.next;
        } while (edgeData);
      }
    }
    if (this.type !== "directed") {
      for (const neighbor in nodeData.undirected) {
        edgeData = nodeData.undirected[neighbor];
        do {
          dropEdgeFromData(this, edgeData);
          edgeData = edgeData.next;
        } while (edgeData);
      }
    }
    this._nodes.delete(node);
    this.emit("nodeDropped", {
      key: node,
      attributes: nodeData.attributes
    });
  }
  dropEdge(edge) {
    let edgeData;
    if (arguments.length > 1) {
      const source = "" + arguments[0];
      const target = "" + arguments[1];
      edgeData = getMatchingEdge(this, source, target, this.type);
      if (!edgeData)
        throw new NotFoundGraphError(`Graph.dropEdge: could not find the "${source}" -> "${target}" edge in the graph.`);
    } else {
      edge = "" + edge;
      edgeData = this._edges.get(edge);
      if (!edgeData)
        throw new NotFoundGraphError(`Graph.dropEdge: could not find the "${edge}" edge in the graph.`);
    }
    dropEdgeFromData(this, edgeData);
    return this;
  }
  dropDirectedEdge(source, target) {
    if (arguments.length < 2)
      throw new UsageGraphError("Graph.dropDirectedEdge: it does not make sense to try and drop a directed edge by key. What if the edge with this key is undirected? Use #.dropEdge for this purpose instead.");
    if (this.multi)
      throw new UsageGraphError("Graph.dropDirectedEdge: cannot use a {source,target} combo when dropping an edge in a MultiGraph since we cannot infer the one you want to delete as there could be multiple ones.");
    source = "" + source;
    target = "" + target;
    const edgeData = getMatchingEdge(this, source, target, "directed");
    if (!edgeData)
      throw new NotFoundGraphError(`Graph.dropDirectedEdge: could not find a "${source}" -> "${target}" edge in the graph.`);
    dropEdgeFromData(this, edgeData);
    return this;
  }
  dropUndirectedEdge(source, target) {
    if (arguments.length < 2)
      throw new UsageGraphError("Graph.dropUndirectedEdge: it does not make sense to drop a directed edge by key. What if the edge with this key is undirected? Use #.dropEdge for this purpose instead.");
    if (this.multi)
      throw new UsageGraphError("Graph.dropUndirectedEdge: cannot use a {source,target} combo when dropping an edge in a MultiGraph since we cannot infer the one you want to delete as there could be multiple ones.");
    const edgeData = getMatchingEdge(this, source, target, "undirected");
    if (!edgeData)
      throw new NotFoundGraphError(`Graph.dropUndirectedEdge: could not find a "${source}" -> "${target}" edge in the graph.`);
    dropEdgeFromData(this, edgeData);
    return this;
  }
  clear() {
    this._edges.clear();
    this._nodes.clear();
    this._resetInstanceCounters();
    this.emit("cleared");
  }
  clearEdges() {
    const iterator = this._nodes.values();
    let step;
    while (step = iterator.next(), step.done !== true) {
      step.value.clear();
    }
    this._edges.clear();
    this._resetInstanceCounters();
    this.emit("edgesCleared");
  }
  getAttribute(name) {
    return this._attributes[name];
  }
  getAttributes() {
    return this._attributes;
  }
  hasAttribute(name) {
    return this._attributes.hasOwnProperty(name);
  }
  setAttribute(name, value) {
    this._attributes[name] = value;
    this.emit("attributesUpdated", {
      type: "set",
      attributes: this._attributes,
      name
    });
    return this;
  }
  updateAttribute(name, updater) {
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError("Graph.updateAttribute: updater should be a function.");
    const value = this._attributes[name];
    this._attributes[name] = updater(value);
    this.emit("attributesUpdated", {
      type: "set",
      attributes: this._attributes,
      name
    });
    return this;
  }
  removeAttribute(name) {
    delete this._attributes[name];
    this.emit("attributesUpdated", {
      type: "remove",
      attributes: this._attributes,
      name
    });
    return this;
  }
  replaceAttributes(attributes) {
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError("Graph.replaceAttributes: provided attributes are not a plain object.");
    this._attributes = attributes;
    this.emit("attributesUpdated", {
      type: "replace",
      attributes: this._attributes
    });
    return this;
  }
  mergeAttributes(attributes) {
    if (!isPlainObject(attributes))
      throw new InvalidArgumentsGraphError("Graph.mergeAttributes: provided attributes are not a plain object.");
    assign(this._attributes, attributes);
    this.emit("attributesUpdated", {
      type: "merge",
      attributes: this._attributes,
      data: attributes
    });
    return this;
  }
  updateAttributes(updater) {
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError("Graph.updateAttributes: provided updater is not a function.");
    this._attributes = updater(this._attributes);
    this.emit("attributesUpdated", {
      type: "update",
      attributes: this._attributes
    });
    return this;
  }
  updateEachNodeAttributes(updater, hints) {
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError("Graph.updateEachNodeAttributes: expecting an updater function.");
    if (hints && !validateHints(hints))
      throw new InvalidArgumentsGraphError("Graph.updateEachNodeAttributes: invalid hints. Expecting an object having the following shape: {attributes?: [string]}");
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      nodeData.attributes = updater(nodeData.key, nodeData.attributes);
    }
    this.emit("eachNodeAttributesUpdated", {
      hints: hints ? hints : null
    });
  }
  updateEachEdgeAttributes(updater, hints) {
    if (typeof updater !== "function")
      throw new InvalidArgumentsGraphError("Graph.updateEachEdgeAttributes: expecting an updater function.");
    if (hints && !validateHints(hints))
      throw new InvalidArgumentsGraphError("Graph.updateEachEdgeAttributes: invalid hints. Expecting an object having the following shape: {attributes?: [string]}");
    const iterator = this._edges.values();
    let step, edgeData, sourceData, targetData;
    while (step = iterator.next(), step.done !== true) {
      edgeData = step.value;
      sourceData = edgeData.source;
      targetData = edgeData.target;
      edgeData.attributes = updater(edgeData.key, edgeData.attributes, sourceData.key, targetData.key, sourceData.attributes, targetData.attributes, edgeData.undirected);
    }
    this.emit("eachEdgeAttributesUpdated", {
      hints: hints ? hints : null
    });
  }
  forEachAdjacencyEntry(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError("Graph.forEachAdjacencyEntry: expecting a callback.");
    forEachAdjacency(false, false, false, this, callback);
  }
  forEachAdjacencyEntryWithOrphans(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError("Graph.forEachAdjacencyEntryWithOrphans: expecting a callback.");
    forEachAdjacency(false, false, true, this, callback);
  }
  forEachAssymetricAdjacencyEntry(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError("Graph.forEachAssymetricAdjacencyEntry: expecting a callback.");
    forEachAdjacency(false, true, false, this, callback);
  }
  forEachAssymetricAdjacencyEntryWithOrphans(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError("Graph.forEachAssymetricAdjacencyEntryWithOrphans: expecting a callback.");
    forEachAdjacency(false, true, true, this, callback);
  }
  nodes() {
    return Array.from(this._nodes.keys());
  }
  forEachNode(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError("Graph.forEachNode: expecting a callback.");
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      callback(nodeData.key, nodeData.attributes);
    }
  }
  findNode(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError("Graph.findNode: expecting a callback.");
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      if (callback(nodeData.key, nodeData.attributes))
        return nodeData.key;
    }
    return;
  }
  mapNodes(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError("Graph.mapNode: expecting a callback.");
    const iterator = this._nodes.values();
    let step, nodeData;
    const result = new Array(this.order);
    let i = 0;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      result[i++] = callback(nodeData.key, nodeData.attributes);
    }
    return result;
  }
  someNode(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError("Graph.someNode: expecting a callback.");
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      if (callback(nodeData.key, nodeData.attributes))
        return true;
    }
    return false;
  }
  everyNode(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError("Graph.everyNode: expecting a callback.");
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      if (!callback(nodeData.key, nodeData.attributes))
        return false;
    }
    return true;
  }
  filterNodes(callback) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError("Graph.filterNodes: expecting a callback.");
    const iterator = this._nodes.values();
    let step, nodeData;
    const result = [];
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      if (callback(nodeData.key, nodeData.attributes))
        result.push(nodeData.key);
    }
    return result;
  }
  reduceNodes(callback, initialValue) {
    if (typeof callback !== "function")
      throw new InvalidArgumentsGraphError("Graph.reduceNodes: expecting a callback.");
    if (arguments.length < 2)
      throw new InvalidArgumentsGraphError("Graph.reduceNodes: missing initial value. You must provide it because the callback takes more than one argument and we cannot infer the initial value from the first iteration, as you could with a simple array.");
    let accumulator = initialValue;
    const iterator = this._nodes.values();
    let step, nodeData;
    while (step = iterator.next(), step.done !== true) {
      nodeData = step.value;
      accumulator = callback(accumulator, nodeData.key, nodeData.attributes);
    }
    return accumulator;
  }
  nodeEntries() {
    const iterator = this._nodes.values();
    return {
      [Symbol.iterator]() {
        return this;
      },
      next() {
        const step = iterator.next();
        if (step.done)
          return step;
        const data = step.value;
        return {
          value: { node: data.key, attributes: data.attributes },
          done: false
        };
      }
    };
  }
  export() {
    const nodes = new Array(this._nodes.size);
    let i = 0;
    this._nodes.forEach((data, key) => {
      nodes[i++] = serializeNode(key, data);
    });
    const edges = new Array(this._edges.size);
    i = 0;
    this._edges.forEach((data, key) => {
      edges[i++] = serializeEdge(this.type, key, data);
    });
    return {
      options: {
        type: this.type,
        multi: this.multi,
        allowSelfLoops: this.allowSelfLoops
      },
      attributes: this.getAttributes(),
      nodes,
      edges
    };
  }
  import(data, merge = false) {
    if (data instanceof Graph) {
      data.forEachNode((n, a) => {
        if (merge)
          this.mergeNode(n, a);
        else
          this.addNode(n, a);
      });
      data.forEachEdge((e, a, s, t, _sa, _ta, u) => {
        if (merge) {
          if (u)
            this.mergeUndirectedEdgeWithKey(e, s, t, a);
          else
            this.mergeDirectedEdgeWithKey(e, s, t, a);
        } else {
          if (u)
            this.addUndirectedEdgeWithKey(e, s, t, a);
          else
            this.addDirectedEdgeWithKey(e, s, t, a);
        }
      });
      return this;
    }
    if (!isPlainObject(data))
      throw new InvalidArgumentsGraphError("Graph.import: invalid argument. Expecting a serialized graph or, alternatively, a Graph instance.");
    if (data.attributes) {
      if (!isPlainObject(data.attributes))
        throw new InvalidArgumentsGraphError("Graph.import: invalid attributes. Expecting a plain object.");
      if (merge)
        this.mergeAttributes(data.attributes);
      else
        this.replaceAttributes(data.attributes);
    }
    let i, l, list, node, edge;
    if (data.nodes) {
      list = data.nodes;
      if (!Array.isArray(list))
        throw new InvalidArgumentsGraphError("Graph.import: invalid nodes. Expecting an array.");
      for (i = 0, l = list.length;i < l; i++) {
        node = list[i];
        validateSerializedNode(node);
        const { key, attributes } = node;
        if (merge)
          this.mergeNode(key, attributes);
        else
          this.addNode(key, attributes);
      }
    }
    if (data.edges) {
      let undirectedByDefault = false;
      if (this.type === "undirected") {
        undirectedByDefault = true;
      }
      list = data.edges;
      if (!Array.isArray(list))
        throw new InvalidArgumentsGraphError("Graph.import: invalid edges. Expecting an array.");
      for (i = 0, l = list.length;i < l; i++) {
        edge = list[i];
        validateSerializedEdge(edge);
        const {
          source,
          target,
          attributes,
          undirected = undirectedByDefault
        } = edge;
        let method;
        if ("key" in edge) {
          method = merge ? undirected ? this.mergeUndirectedEdgeWithKey : this.mergeDirectedEdgeWithKey : undirected ? this.addUndirectedEdgeWithKey : this.addDirectedEdgeWithKey;
          method.call(this, edge.key, source, target, attributes);
        } else {
          method = merge ? undirected ? this.mergeUndirectedEdge : this.mergeDirectedEdge : undirected ? this.addUndirectedEdge : this.addDirectedEdge;
          method.call(this, source, target, attributes);
        }
      }
    }
    return this;
  }
  nullCopy(options) {
    const graph = new Graph(assign({}, this._options, options));
    graph.replaceAttributes(assign({}, this.getAttributes()));
    return graph;
  }
  emptyCopy(options) {
    const graph = this.nullCopy(options);
    this._nodes.forEach((nodeData, key) => {
      const attributes = assign({}, nodeData.attributes);
      nodeData = new graph.NodeDataClass(key, attributes);
      graph._nodes.set(key, nodeData);
    });
    return graph;
  }
  copy(options) {
    options = options || {};
    if (typeof options.type === "string" && options.type !== this.type && options.type !== "mixed")
      throw new UsageGraphError(`Graph.copy: cannot create an incompatible copy from "${this.type}" type to "${options.type}" because this would mean losing information about the current graph.`);
    if (typeof options.multi === "boolean" && options.multi !== this.multi && options.multi !== true)
      throw new UsageGraphError("Graph.copy: cannot create an incompatible copy by downgrading a multi graph to a simple one because this would mean losing information about the current graph.");
    if (typeof options.allowSelfLoops === "boolean" && options.allowSelfLoops !== this.allowSelfLoops && options.allowSelfLoops !== true)
      throw new UsageGraphError("Graph.copy: cannot create an incompatible copy from a graph allowing self loops to one that does not because this would mean losing information about the current graph.");
    const graph = this.emptyCopy(options);
    const iterator = this._edges.values();
    let step, edgeData;
    while (step = iterator.next(), step.done !== true) {
      edgeData = step.value;
      addEdge(graph, "copy", false, edgeData.undirected, edgeData.key, edgeData.source.key, edgeData.target.key, assign({}, edgeData.attributes));
    }
    return graph;
  }
  toJSON() {
    return this.export();
  }
  toString() {
    return "[object Graph]";
  }
  inspect() {
    const nodes = {};
    this._nodes.forEach((data, key) => {
      nodes[key] = data.attributes;
    });
    const edges = {}, multiIndex = {};
    this._edges.forEach((data, key) => {
      const direction = data.undirected ? "--" : "->";
      let label = "";
      let source = data.source.key;
      let target = data.target.key;
      let tmp;
      if (data.undirected && source > target) {
        tmp = source;
        source = target;
        target = tmp;
      }
      const desc = `(${source})${direction}(${target})`;
      if (!key.startsWith("geid_")) {
        label += `[${key}]: `;
      } else if (this.multi) {
        if (typeof multiIndex[desc] === "undefined") {
          multiIndex[desc] = 0;
        } else {
          multiIndex[desc]++;
        }
        label += `${multiIndex[desc]}. `;
      }
      label += desc;
      edges[label] = data.attributes;
    });
    const dummy = {};
    for (const k in this) {
      if (this.hasOwnProperty(k) && !EMITTER_PROPS.has(k) && typeof this[k] !== "function" && typeof k !== "symbol")
        dummy[k] = this[k];
    }
    dummy.attributes = this._attributes;
    dummy.nodes = nodes;
    dummy.edges = edges;
    privateProperty(dummy, "constructor", this.constructor);
    return dummy;
  }
}
if (typeof Symbol !== "undefined")
  Graph.prototype[Symbol.for("nodejs.util.inspect.custom")] = Graph.prototype.inspect;
EDGE_ADD_METHODS.forEach((method) => {
  ["add", "merge", "update"].forEach((verb) => {
    const name = method.name(verb);
    const fn = verb === "add" ? addEdge : mergeEdge;
    if (method.generateKey) {
      Graph.prototype[name] = function(source, target, attributes) {
        return fn(this, name, true, (method.type || this.type) === "undirected", null, source, target, attributes, verb === "update");
      };
    } else {
      Graph.prototype[name] = function(edge, source, target, attributes) {
        return fn(this, name, false, (method.type || this.type) === "undirected", edge, source, target, attributes, verb === "update");
      };
    }
  });
});
attachNodeAttributesMethods(Graph);
attachEdgeAttributesMethods(Graph);
attachEdgeIterationMethods(Graph);
attachNeighborIterationMethods(Graph);

class DirectedGraph extends Graph {
  constructor(options) {
    const finalOptions = assign({ type: "directed" }, options);
    if ("multi" in finalOptions && finalOptions.multi !== false)
      throw new InvalidArgumentsGraphError("DirectedGraph.from: inconsistent indication that the graph should be multi in given options!");
    if (finalOptions.type !== "directed")
      throw new InvalidArgumentsGraphError('DirectedGraph.from: inconsistent "' + finalOptions.type + '" type in given options!');
    super(finalOptions);
  }
}

class UndirectedGraph extends Graph {
  constructor(options) {
    const finalOptions = assign({ type: "undirected" }, options);
    if ("multi" in finalOptions && finalOptions.multi !== false)
      throw new InvalidArgumentsGraphError("UndirectedGraph.from: inconsistent indication that the graph should be multi in given options!");
    if (finalOptions.type !== "undirected")
      throw new InvalidArgumentsGraphError('UndirectedGraph.from: inconsistent "' + finalOptions.type + '" type in given options!');
    super(finalOptions);
  }
}

class MultiGraph extends Graph {
  constructor(options) {
    const finalOptions = assign({ multi: true }, options);
    if ("multi" in finalOptions && finalOptions.multi !== true)
      throw new InvalidArgumentsGraphError("MultiGraph.from: inconsistent indication that the graph should be simple in given options!");
    super(finalOptions);
  }
}

class MultiDirectedGraph extends Graph {
  constructor(options) {
    const finalOptions = assign({ type: "directed", multi: true }, options);
    if ("multi" in finalOptions && finalOptions.multi !== true)
      throw new InvalidArgumentsGraphError("MultiDirectedGraph.from: inconsistent indication that the graph should be simple in given options!");
    if (finalOptions.type !== "directed")
      throw new InvalidArgumentsGraphError('MultiDirectedGraph.from: inconsistent "' + finalOptions.type + '" type in given options!');
    super(finalOptions);
  }
}

class MultiUndirectedGraph extends Graph {
  constructor(options) {
    const finalOptions = assign({ type: "undirected", multi: true }, options);
    if ("multi" in finalOptions && finalOptions.multi !== true)
      throw new InvalidArgumentsGraphError("MultiUndirectedGraph.from: inconsistent indication that the graph should be simple in given options!");
    if (finalOptions.type !== "undirected")
      throw new InvalidArgumentsGraphError('MultiUndirectedGraph.from: inconsistent "' + finalOptions.type + '" type in given options!');
    super(finalOptions);
  }
}
function attachStaticFromMethod(Class) {
  Class.from = function(data, options) {
    const finalOptions = assign({}, data.options, options);
    const instance = new Class(finalOptions);
    instance.import(data);
    return instance;
  };
}
attachStaticFromMethod(Graph);
attachStaticFromMethod(DirectedGraph);
attachStaticFromMethod(UndirectedGraph);
attachStaticFromMethod(MultiGraph);
attachStaticFromMethod(MultiDirectedGraph);
attachStaticFromMethod(MultiUndirectedGraph);
Graph.Graph = Graph;
Graph.DirectedGraph = DirectedGraph;
Graph.UndirectedGraph = UndirectedGraph;
Graph.MultiGraph = MultiGraph;
Graph.MultiDirectedGraph = MultiDirectedGraph;
Graph.MultiUndirectedGraph = MultiUndirectedGraph;
Graph.InvalidArgumentsGraphError = InvalidArgumentsGraphError;
Graph.NotFoundGraphError = NotFoundGraphError;
Graph.UsageGraphError = UsageGraphError;

// vendor/graphology-entry.js
var import_graphology_layout_forceatlas2 = __toESM(require_graphology_layout_forceatlas2());
var export_forceAtlas2 = import_graphology_layout_forceatlas2.default;

export {
  Graph,
  export_forceAtlas2 as forceAtlas2
};
