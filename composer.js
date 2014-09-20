(function() {
    var STOCK_AREA_HEIGHT = 140;
    var PORT_RADIUS = 4;
    var REMOVE_BUTTON_SIZE = 8;
    var PATCH_WIDTH = 100;
    var PATCH_HEIGHT = 80;
    var PATCH_MARGIN = 10;
    var MONITOR_WIDTH = 64;
    var MONITOR_HEIGHT = 40;
    var GAIN_SCALE = 100;
    var Q_SCALE = 10000;
    var DELAY_TIME_SCALE = 1000;
    var ATTACK_SCALE = 1000;
    var RELEASE_SCALE = 1000;
    var PLAYBACK_RATE_SCALE = 100;
    var FFT_SIZE = 64;

    var stage, stockArea, compositeArea, activeConnection;
    var audioContext, mediaNode;
    var freqBuffer = new Uint8Array(FFT_SIZE / 2);
    var selectedPatch = null;

    var nodeSpec = {
        MediaElementAudioSource : {
            label : 'media',
            pos : 0,
            maxInstance : 1,
            build : function() { return mediaNode; }
        },
        Oscillator : {
            label : 'oscillator',
            pos : 1,
            maxInstance : Number.MAX_VALUE,
            build : function() {
                var node = audioContext.createOscillator();
                node.start();
                return node;
            }
        },
        AudioBufferSource : {
            label : 'buffer',
            pos : null,
            maxInstance : Number.MAX_VALUE,
            build : function() {
                var node = audioContext.createBufferSource();
                node.loop = true;
                return node;
            }
        },
        Gain : {
            label : 'gain',
            pos : 2,
            maxInstance : Number.MAX_VALUE,
            build : function() { return audioContext.createGain(); }
        },
        ChannelSplitter : {
            label : 'split',
            pos : 3,
            maxInstance : Number.MAX_VALUE,
            build : function() { return audioContext.createChannelSplitter(); }
        },
        ChannelMerger : {
            label : 'merge',
            pos : 4,
            maxInstance : Number.MAX_VALUE,
            build : function() { return audioContext.createChannelMerger(); }
        },
        BiquadFilter : {
            label : 'biquad',
            pos : 5,
            maxInstance : Number.MAX_VALUE,
            build : function() { return audioContext.createBiquadFilter(); }
        },
        Convolver : {
            label : 'convolve',
            pos : 6,
            maxInstance : Number.MAX_VALUE,
            build : function() {
                var node = audioContext.createConvolver();
                node.buffer = impulseResponse(4, 4, false);
                return node;
            }
        },
        Delay : {
            label : 'delay',
            pos : 7,
            maxInstance : Number.MAX_VALUE,
            build : function() { return audioContext.createDelay(5); }
        },
        DynamicsCompressor : {
            label : 'compress',
            pos : 8,
            maxInstance : Number.MAX_VALUE,
            build : function() { return audioContext.createDynamicsCompressor(); }
        },
        WaveShaper : {
            label : 'shaper',
            pos : 9,
            maxInstance : Number.MAX_VALUE,
            build : function() {
                var node = audioContext.createWaveShaper();
                node.curve = makeDistortionCurve(400);
                return node;
            }
        },
        Analyser: {
            label : 'analyser',
            pos : 10,
            maxInstance : Number.MAX_VALUE,
            build : function() {
                var node = audioContext.createAnalyser();
                node.fftSize = FFT_SIZE;
                return node;
            }
        },
        AudioDestination : {
            label : 'dest',
            pos : 11,
            maxInstance : 1,
            build : function() { return audioContext.destination; }
        }
    };
    var channelLabels = ['L', 'R', 'C', 'LFE', 'SL', 'SR'];

    Rectangle.prototype.includes = function(x, y) {
        return this.x <= x && x < this.x + this.width && this.y <= y && y < this.y + this.height;
    }

    function setupStage() {
        var workspace;

        function onDragOver(event) {
            event.dataTransfer.dropEffect = 'copy';
            event.stopPropagation();
            event.preventDefault();
        }
        function onDrop(event) {
            var files = event.dataTransfer.files;
            var local = compositeArea.globalToLocal(
                    event.hasOwnProperty('offsetX') ? event.offsetX : event.layerX,
                    event.hasOwnProperty('offsetY') ? event.offsetY : event.layerY);
            var patch, reader, loading;

            if (0 < files.length) {
                if (files[0].type.match('audio/.*')) {
                    if (compositeArea.getBounds().includes(local.x, local.y)) {
                        patch = Patch('AudioBufferSource', 'composite');
                        patch.x = local.x;
                        patch.y = local.y;
                        patch.mouseEnabled = false;
                        compositeArea.patches.addChild(patch);

                        loading = new Text('loading', 'normal 18px sanserif', '#fff');
                        loading.x = -(patch.getBounds().width - loading.getBounds().width) / 2;
                        loading.y = -loading.getBounds().height / 2;
                        loading.fadeOut = function() {
                            Tween.get(loading).to({alpha: 0}, 200).call(loading.fadeIn);
                        }
                        loading.fadeIn = function() {
                            Tween.get(loading).to({alpha: 1}, 200).call(loading.fadeOut);
                        }
                        loading.fadeOut();
                        patch.addChild(loading);

                        reader = new FileReader();
                        reader.readAsArrayBuffer(files[0]);
                        reader.onload = function(event) {
                            audioContext.decodeAudioData(
                                    event.target.result,
                                    function(buffer) {
                                        patch.removeChild(loading);
                                        patch.mouseEnabled = true;
                                        patch.node.buffer = buffer;
                                        patch.node.start(0);
                                    },
                                    function() {
                                        console.log('decoding error.');
                                    });
                        }
                    }
                    event.stopPropagation();
                    event.preventDefault();
                }
            }
        }
        
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContext();
        mediaNode = audioContext.createMediaElementSource(document.getElementById('music'));
        workspace = document.getElementById('workspace');

        stage = new Stage('mainStage');
        stage.canvas.width = workspace.offsetWidth;
        stage.canvas.height = workspace.offsetHeight;

        compositeArea = CompositeArea(stage.canvas.width, stage.canvas.height - STOCK_AREA_HEIGHT);
        compositeArea.x = 0;
        compositeArea.y = 0;
        stage.addChild(compositeArea);

        stockArea = StockArea(stage.canvas.width, STOCK_AREA_HEIGHT);
        stockArea.x = 0;
        stockArea.y = stage.canvas.height - STOCK_AREA_HEIGHT;
        stage.addChild(stockArea);

        Ticker.timingMode = Ticker.RAF;
        Ticker.setFPS(60);
        Ticker.addEventListener('tick', onTick);

        stage.canvas.addEventListener('dragover', onDragOver);
        stage.canvas.addEventListener('drop', onDrop);
    }

    function onTick(event) {
        var delta = event.delta * 0.001;
        compositeArea.update(delta);
        stockArea.update(delta);
        stage.update();
        compositeArea.drawConnections();
    }

    function CompositeArea(width, height) {
        var area, selectedPane = null;
        var graphics = new createjs.Graphics();

        function getPatchUnderPoint(x, y) {
            var patch, i, local, result = null;
            for (i = 0; i < area.patches.getNumChildren(); i++) {
                patch = area.patches.children[i];
                local = area.localToLocal(x, y, patch);
                if (patch.getBounds().includes(local.x, local.y)) {
                    result = patch;
                    break;
                }
            }
            return result;
        }
        function onClick(event) {
            var local, patch;

            if (selectedPane) {
                selectedPane.style.display = 'none';
            }

            local = area.globalToLocal(event.stageX, event.stageY);
            patch = getPatchUnderPoint(local.x, local.y);
            if (patch) {
                selectedPane = document.querySelector('#' + nodeSpec[patch.nodeType].label + 'Params');
                selectedPatch = patch;
                refreshPane(patch);
            } else {
                selectedPane = null;
                selectedPatch = null;
            }

            if (selectedPane) {
                selectedPane.style.display = 'block';
            }

            event.preventDefault();
        }
        function patchCount(type) {
            return area.patches.children
                .map(function(patch) { return patch.nodeType === type; })
                .reduce(function(prev, curr) { return prev + curr; }, 0);
        }
        function update(delta) {
            var i, j, patch;

            for (i = 0; i < compositeArea.patches.getNumChildren(); i++) {
                patch = compositeArea.patches.children[i];
                if (patch.nodeType === 'Analyser') {
                    patch.node.getByteFrequencyData(freqBuffer);
                    patch.monitor.graphics.clear().beginStroke('#FFFF66').setStrokeStyle(2);
                    for (j = 0; j < freqBuffer.length; j++) {
                        patch.monitor.graphics
                            .moveTo(2 * j, MONITOR_HEIGHT)
                            .lineTo(2 * j, MONITOR_HEIGHT * (1.0 - freqBuffer[j] / 255.0));
                    }
                }
            }
        }
        function drawConnections() {
            var i, j, k, patch, inputPort, outputPort, op, ip;

            graphics.clear();
            if (activeConnection) {
                drawConnection(graphics,
                        activeConnection.outputX,
                        activeConnection.outputY,
                        activeConnection.inputX,
                        activeConnection.inputY);
            }
            for (i = 0; i < compositeArea.patches.getNumChildren(); i++) {
                patch = compositeArea.patches.children[i];
                for (j = 0; j < patch.inputPorts.getNumChildren(); j++) {
                    inputPort = patch.inputPorts.children[j];
                    for (k = 0; k < inputPort.peers.length; k++) {
                        outputPort = inputPort.peers[k];
                        op = outputPort.localToGlobal(0, 0);
                        ip = inputPort.localToGlobal(0, 0);
                        drawConnection(graphics, op.x, op.y, ip.x, ip.y);
                    }
                }
            }
            graphics.draw(stage.canvas.getContext('2d'));
        }

        area = new Container();
        area.setBounds(0, 0, width, height);
        area.getPatchUnderPoint = getPatchUnderPoint;
        area.patchCount = patchCount;
        area.update = update;
        area.drawConnections = drawConnections;
        area.addEventListener('click', onClick);

        // This shape is needed for correctly tracking mouse event.
        area.background = new Shape();
        area.background.hitArea = new Shape();
        area.background.hitArea.graphics.beginFill('#000').drawRect(0, 0, width, height);
        area.addChild(area.background);

        area.trashbox = new Bitmap('trashbox.png');
        area.trashbox.x = width - 25;
        area.trashbox.y = 5;
        area.addChild(area.trashbox);

        area.patches = new Container();
        area.addChild(area.patches);

        return area;
    }

    function StockArea(width, height) {
        var area;
        var i, patch, stockables;
        var vx = 0, prevX;
        var DECEL = 400;
        var ARROW_ALPHA = 0.7;
        
        function onMouseDown(event) {
            vx = 0;
            prevX = event.stageX;
            event.stopPropagation();
        }
        function onPressMove(event) {
            vx += 3.0 * (event.stageX - prevX);
            prevX = event.stageX;
        }
        function update(delta) {
            area.patches.x += delta * vx;
            if (0 < vx) {
                vx = Math.max(0, vx - DECEL * delta);
                if (0 < area.patches.x) {
                    vx = 0;
                    area.patches.x = 0;
                }
            } else {
                vx = Math.min(0, vx + DECEL * delta);
                if (area.patches.x + area.patches.getBounds().width < width) {
                    vx = 0;
                    area.patches.x = width - area.patches.getBounds().width;
                }
            }
            
            if (-10 <= area.patches.x && -10 > area.patches.prevX) {
                Tween.get(area.leftArrow).to({alpha : 0}, 100);
            }
            if (-10 > area.patches.x && -10 <= area.patches.prevX) {
                Tween.get(area.leftArrow).to({alpha : ARROW_ALPHA}, 100);
            }
            if (area.patches.x + area.patches.getBounds().width < width + 10 &&
                area.patches.prevX + area.patches.getBounds().width >= width + 10) {
                Tween.get(area.rightArrow).to({alpha : 0}, 100);
            }
            if (area.patches.x + area.patches.getBounds().width >= width + 10 &&
                area.patches.prevX + area.patches.getBounds().width < width + 10) {
                Tween.get(area.rightArrow).to({alpha : ARROW_ALPHA}, 100);
            }
            area.patches.prevX = area.patches.x;
        }
        function getStockables() {
            stockables = [];
            for (type in nodeSpec) {
                if (nodeSpec[type].pos !== null) {
                    stockables.push(type);
                }
            }
            return stockables;
        }

        area = new Container();
        area.update = update;
        area.setBounds(0, 0, width, height);

        area.background = new Shape();
        area.background.graphics.beginFill('#888').drawRect(0, 0, width, height);
        area.background.alpha = 0.3;
        area.addChild(area.background);

        stockables = getStockables();
        area.patches = new Container();
        area.patches.x = 0;
        area.patches.y = 0;
        area.patches.prevX = 0;
        area.patches.setBounds(0, 0, PATCH_MARGIN + stockables.length * (PATCH_WIDTH + PATCH_MARGIN), STOCK_AREA_HEIGHT);
        area.addChild(area.patches);

        area.rightArrow = new Shape();
        area.rightArrow.graphics.beginFill('#fff').moveTo(0, 0).lineTo(-15, 15).lineTo(-15, -15);
        area.rightArrow.alpha = ARROW_ALPHA;
        area.rightArrow.x = area.getBounds().width - 5;
        area.rightArrow.y = area.getBounds().height / 2;
        area.addChild(area.rightArrow);

        area.leftArrow = new Shape();
        area.leftArrow.graphics.beginFill('#fff').moveTo(0, 0).lineTo(15, 15).lineTo(15, -15);
        area.leftArrow.alpha = 0;
        area.leftArrow.x = 5;
        area.leftArrow.y = area.getBounds().height / 2;
        area.addChild(area.leftArrow);

        area.addEventListener('mousedown', onMouseDown);
        area.addEventListener('pressmove', onPressMove);

        for (i = 0; i < stockables.length; i++) {
            patch = Patch(stockables[i], 'stock');
            patch.x = patchCoord(nodeSpec[stockables[i]].pos).x;
            patch.y = patchCoord(nodeSpec[stockables[i]].pos).y;
            area.patches.addChild(patch);
        }

        return area;
    }

    function Patch(type, place) {
        var patch, port, i;
        var label, x, y;
        var spec = nodeSpec[type];

        function onMouseDown1(event) {
            stockArea.patches.removeChild(patch);

            stage.addChild(patch);
            patch.x = event.stageX;
            patch.y = event.stageY;

            patch.addEventListener('pressmove', onPressMove1);
            patch.addEventListener('pressup', onPressUp1);
        }
        function onPressMove1(event) {
            patch.x = event.stageX;
            patch.y = event.stageY;
        }
        function onPressUp1(event) {
            var local, returnPos, bounds, newPatch;

            patch.removeEventListener('pressup', onPressUp1);
            patch.removeEventListener('pressmove', onPressMove1);

            local = compositeArea.globalToLocal(event.stageX, event.stageY);
            if (compositeArea.getBounds().includes(local.x, local.y) &&
                compositeArea.patchCount(type) < nodeSpec[type].maxInstance) {

                patch.removeEventListener('mousedown', onMouseDown1);
                patch.addEventListener('pressmove', onPressMove2);
                patch.addEventListener('pressup', onPressUp2);

                patch.x = local.x;
                patch.y = local.y;
                stage.removeChild(patch);
                compositeArea.patches.addChild(patch);

                newPatch = Patch(type, 'stock');
                newPatch.x = patchCoord(spec.pos).x;
                newPatch.y = patchCoord(spec.pos).y;
                stockArea.patches.addChild(newPatch);
            } else {
                returnPos = stockArea.patches.localToGlobal(patchCoord(spec.pos).x, patchCoord(spec.pos).y);
                Tween.get(patch).to({x : returnPos.x, y : returnPos.y}, 400, Ease.elasticOut).call(function() {
                    stage.removeChild(patch);
                    stockArea.patches.addChild(patch);
                    patch.x = patchCoord(spec.pos).x;
                    patch.y = patchCoord(spec.pos).y;
                });
            }
        }
        function onPressMove2(event) {
            var local = compositeArea.globalToLocal(event.stageX, event.stageY);
            if (compositeArea.getBounds().includes(local.x, local.y)) {
                patch.x = event.stageX;
                patch.y = event.stageY;
            }

            if (intersect(patch, compositeArea.trashbox)) {
                patch.alpha = 0.5;
            } else {
                patch.alpha = 1.0;
            }
        }
        function onPressUp2(event) {
            if (patch.alpha !== 1.0) {
                remove();
            }
        }
        function getOutputPortUnderPoint(x, y) {
            var port, i, local, result = null;
            for (i = 0; i < patch.outputPorts.getNumChildren(); i++) {
                port = patch.outputPorts.children[i];
                local = patch.localToLocal(x, y, port);
                if (port.getBounds().includes(local.x, local.y)) {
                    result = port;
                    break;
                }
            }
            return result;
        }
        function getInputPortUnderPoint(x, y) {
            var port, i, local, result = null;
            for (i = 0; i < patch.inputPorts.getNumChildren(); i++) {
                port = patch.inputPorts.children[i];
                local = patch.localToLocal(x, y, port);
                if (port.getBounds().includes(local.x, local.y)) {
                    result = port;
                    break;
                }
            }
            return result;
        }
        function bgColor() {
            var color;
            if (patch.node.numberOfInputs === 0) {
                color = '#f66';
            } else if (patch.node.numberOfOutputs === 0) {
                color = '#26f';
            } else {
                color = '#2f6';
            }
            return color;
        }
        function remove() {
            var i;

            compositeArea.patches.removeChild(patch);

            for (i = 0; i < patch.outputPorts.getNumChildren(); i++) {
                patch.outputPorts.children[i].disconnect();
            }
            for (i = 0; i < patch.inputPorts.getNumChildren(); i++) {
                patch.inputPorts.children[i].disconnect();
            }
        }

        patch = new Container();
        patch.nodeType = type;
        patch.node = spec.build();
        patch.alpha = 0;
        patch.setBounds(-PATCH_WIDTH / 2, -PATCH_HEIGHT / 2, PATCH_WIDTH, PATCH_HEIGHT);

        patch.getOutputPortUnderPoint = getOutputPortUnderPoint;
        patch.getInputPortUnderPoint = getInputPortUnderPoint;

        patch.background = new Shape();
        patch.background.graphics
            .beginFill(bgColor())
            .drawRoundRect(-PATCH_WIDTH / 2, -PATCH_HEIGHT / 2, PATCH_WIDTH, PATCH_HEIGHT, 5);
        patch.addChild(patch.background);

        patch.nameLabel = new Text(spec.label, 'normal 18px sanserif', '#444');
        patch.nameLabel.x = patch.getBounds().x + (patch.getBounds().width - patch.nameLabel.getBounds().width) / 2;
        patch.nameLabel.y = patch.getBounds().y;
        patch.addChild(patch.nameLabel);

        patch.inputPorts = new Container();
        patch.addChild(patch.inputPorts);

        patch.outputPorts = new Container();
        patch.addChild(patch.outputPorts);

        for (i = 0; i < patch.node.numberOfInputs; i++) {
            x = 8 - patch.getBounds().width / 2;
            y = (i + 1) * patch.getBounds().height / (patch.node.numberOfInputs + 1) - patch.getBounds().height / 2;

            port = Port('input', i);
            port.x = x;
            port.y = y;
            patch.inputPorts.addChild(port);

            if (type === 'ChannelMerger') {
                label = new Text(channelLabels[i], 'normal 8px monotype', '#000');
                label.x = x + 8;
                label.y = y - 4;
                patch.addChild(label);
            }
        }

        for (i = 0; i < patch.node.numberOfOutputs; i++) {
            x = patch.getBounds().width / 2 - 8;
            y = (i + 1) * patch.getBounds().height / (patch.node.numberOfOutputs + 1) - patch.getBounds().height / 2;

            port = Port('output', i);
            port.x = x;
            port.y = y;
            patch.outputPorts.addChild(port);

            if (type === 'ChannelSplitter') {
                label = new Text(channelLabels[i], 'normal 8px monotype', '#000');
                label.x = x - 8 - label.getBounds().width;
                label.y = y - 4;
                patch.addChild(label);
            }
        }

        if (type === 'Analyser') {
            patch.background.graphics
                .beginFill('black')
                .drawRect(-MONITOR_WIDTH / 2, -MONITOR_HEIGHT / 2 + 5, MONITOR_WIDTH, MONITOR_HEIGHT);

            patch.monitor = new Shape();
            patch.monitor.x = -MONITOR_WIDTH / 2;
            patch.monitor.y = -MONITOR_HEIGHT / 2 + 5;
            patch.addChild(patch.monitor);
        }

        Tween.get(patch).to({alpha : 1.0}, 200).call(function() {
            if (place === 'stock') {
                patch.addEventListener('mousedown', onMouseDown1);
            } else {
                patch.addEventListener('pressmove', onPressMove2);
                patch.addEventListener('pressup', onPressUp2);
            }
        });

        return patch;
    }

    function Port(type, channel) {
        var port;

        function onMouseDown(event) {

            if (!isDeployed(port)) {
                return;
            }

            port.addEventListener('pressmove', onPressMove);
            port.addEventListener('pressup', onPressUp);

            activeConnection = {
                inputX : event.stageX,
                inputY : event.stageY,
                outputX : event.stageX,
                outputY : event.stageY
            };

            event.stopPropagation();
        }
        function onPressUp(event) {
            var local, patch, hitPort = null;

            port.removeEventListener('pressup', onPressUp);
            port.removeEventListener('pressmove', onPressMove);

            activeConnection = null;

            local = compositeArea.globalToLocal(event.stageX, event.stageY);
            patch = compositeArea.getPatchUnderPoint(local.x, local.y);
            if (patch) {
                local = patch.globalToLocal(event.stageX, event.stageY);
                if (port.portType === 'input') {
                    hitPort = patch.getOutputPortUnderPoint(local.x, local.y);
                } else {
                    hitPort = patch.getInputPortUnderPoint(local.x, local.y);
                }
                if (hitPort) {
                    port.connect(hitPort);
                }
            }

            event.stopPropagation();
        }
        function onPressMove(event) {
            if (port.portType === 'input') {
                activeConnection.outputX = event.stageX;
                activeConnection.outputY = event.stageY;
            } else {
                activeConnection.inputX = event.stageX;
                activeConnection.inputY = event.stageY;
            }

            event.stopPropagation();
        }
        function onDoubleClick(event) {
            disconnect();
        }
        function connect(peer) {
            var myPatch, peerPatch;

            if (port.peers.indexOf(peer) === -1) {
                port.peers.push(peer);
                peer.peers.push(port);

                myPatch = port.parent.parent;
                peerPatch = peer.parent.parent;

                if (port.portType === 'input') {
                    peerPatch.node.connect(myPatch.node, peer.channel, port.channel);
                } else {
                    myPatch.node.connect(peerPatch.node, port.channel, peer.channel);
                }
            }
        }
        function disconnect() {
            var i, j, peer, patch;

            for (i = 0; i < port.peers.length; i++) {
                peer = port.peers[i];
                peer.peers.splice(peer.peers.indexOf(port), 1);
            }

            if (port.portType === 'input') {
                for (i = 0; i < port.peers.length; i++) {
                    peer = port.peers[i];
                    peer.reconnect();
                }
            } else {
                patch = port.parent.parent;
                patch.node.disconnect(port.channel);
            }

            port.peers = [];
        }
        function reconnect() {
            var patch, peer, peerPatch, i;

            patch = port.parent.parent;
            patch.node.disconnect(port.channel);
            for (i = 0; i < port.peers.length; i++) {
                peer = port.peers[i];
                peerPatch = peer.parent.parent;
                patch.node.connect(peerPatch.node, port.channel, peer.channel);
            }
        }

        port = new Shape();
        port.portType = type;
        port.channel = channel;
        port.graphics.beginFill('#888').drawCircle(0, 0, PORT_RADIUS);
        port.setBounds(-PORT_RADIUS, -PORT_RADIUS, 2 * PORT_RADIUS, 2 * PORT_RADIUS);
        port.addEventListener('mousedown', onMouseDown);
        port.addEventListener('dblclick', onDoubleClick);
        port.peers = [];
        port.connect = connect;
        port.disconnect = disconnect;
        port.reconnect = reconnect;

        return port;
    }
    
    function drawConnection(graphics, outputX, outputY, inputX, inputY) {
        graphics.beginStroke('#fff')
            .setStrokeStyle(2)
            .moveTo(outputX, outputY)
            .bezierCurveTo(
                    outputX + Math.min(100, Math.abs(outputX - inputX)), outputY,
                    inputX - Math.min(100, Math.abs(outputY - inputY)), inputY,
                    inputX, inputY);
    }

    function isDeployed(object) {
        return compositeArea.contains(object);
    }

    function intersect(obj1, obj2) {
        var obj1_pos = obj1.localToGlobal(obj1.getBounds().x, obj1.getBounds().y);
        var obj2_pos = obj2.localToGlobal(obj2.getBounds().x, obj2.getBounds().y);
        var obj1_left = obj1_pos.x, obj1_right = obj1_pos.x + obj1.getBounds().width;
        var obj1_top = obj1_pos.y, obj1_bottom = obj1_pos.y + obj1.getBounds().height;
        var obj2_left = obj2_pos.x, obj2_right = obj2_pos.x + obj2.getBounds().width;
        var obj2_top = obj2_pos.y, obj2_bottom = obj2_pos.y + obj2.getBounds().height;
        return ((obj1_left <= obj2_left && obj2_left < obj1_right) || (obj1_left <= obj2_right && obj2_right < obj1_right)) &&
               ((obj1_top <= obj2_top && obj2_top < obj1_bottom) || (obj1_top <= obj2_bottom && obj2_bottom < obj1_bottom));
    }

    function patchCoord(pos) {
        return {
            x: PATCH_MARGIN + PATCH_WIDTH / 2 + (PATCH_WIDTH + PATCH_MARGIN) * pos,
            y: PATCH_HEIGHT / 2 + (STOCK_AREA_HEIGHT - PATCH_HEIGHT) / 2
        };
    }

    // c.f. http://stackoverflow.com/a/22538980
    function impulseResponse(duration, decay, reverse) {
        var sampleRate = audioContext.sampleRate;
        var length = sampleRate * duration;
        var impulse = audioContext.createBuffer(2, length, sampleRate);
        var impulseL = impulse.getChannelData(0);
        var impulseR = impulse.getChannelData(1);

        if (!decay)
            decay = 2.0;
        for (var i = 0; i < length; i++){
            var n = reverse ? length - i : i;
            impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
            impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
        }
        return impulse;
    }

    // c.f. http://stackoverflow.com/a/22313408
    function makeDistortionCurve(amount) {
        var k = typeof amount === 'number' ? amount : 50,
            n_samples = 44100,
            curve = new Float32Array(n_samples),
            deg = Math.PI / 180,
            i = 0,
            x;
        for ( ; i < n_samples; ++i ) {
            x = i * 2 / n_samples - 1;
            curve[i] = ( 3 + k ) * x * 20 * deg / ( Math.PI + k * Math.abs(x) );
        }
        return curve;
    };

    function setupViews() {

        function oscillator() {
            var i, inputs, node, pane;
            node = nodeSpec.Oscillator.build();
            pane = document.querySelector('#' + nodeSpec.Oscillator.label + 'Params');
            inputs = pane.querySelectorAll('input[name=type]');
            for (i = 0; i < inputs.length; i++) {
                inputs[i].addEventListener('change', function(event) {
                    selectedPatch.node.type = event.target.value;
                });
            }
            pane.querySelector('input[name=frequency]').min = node.frequency.minValue;
            pane.querySelector('input[name=frequency]').max = node.frequency.maxValue;
            pane.querySelector('input[name=frequency]').addEventListener('change', function(event) {
                pane.querySelector('label[name=frequency]').innerText = event.target.value;
                selectedPatch.node.frequency.value = event.target.value;
            });
            pane.querySelector('input[name=detune]').min = node.detune.minValue;
            pane.querySelector('input[name=detune]').max = node.detune.maxValue;
            pane.querySelector('input[name=detune]').addEventListener('change', function(event) {
                pane.querySelector('label[name=detune]').innerText = event.target.value;
                selectedPatch.node.detune.value = event.target.value;
            });
        }
        function audioBuffer() {
            var node, pane;
            node = nodeSpec.AudioBufferSource.build();
            pane = document.querySelector('#' + nodeSpec.AudioBufferSource.label + 'Params');
            pane.querySelector('input[name=playbackRate]').min = node.playbackRate.minValue * PLAYBACK_RATE_SCALE;
            pane.querySelector('input[name=playbackRate]').max = 8 * PLAYBACK_RATE_SCALE;
            pane.querySelector('input[name=playbackRate]').addEventListener('change', function(event) {
                pane.querySelector('label[name=playbackRate]').innerText = event.target.value / PLAYBACK_RATE_SCALE;
                selectedPatch.node.playbackRate.value = event.target.value / PLAYBACK_RATE_SCALE;
            });
        }
        function gain() {
            var node, pane;
            node = nodeSpec.Gain.build();
            pane = document.querySelector('#' + nodeSpec.Gain.label + 'Params');
            pane.querySelector('input[name=gain]').min = node.gain.minValue * GAIN_SCALE;
            pane.querySelector('input[name=gain]').max = node.gain.maxValue * GAIN_SCALE;
            pane.querySelector('input[name=gain]').addEventListener('change', function(event) {
                selectedPatch.node.gain.value = event.target.value / GAIN_SCALE;
            });
        }
        function biquadFilter() {
            var i, inputs, node, pane;
            node = nodeSpec.BiquadFilter.build();
            pane = document.querySelector('#' + nodeSpec.BiquadFilter.label + 'Params');
            inputs = pane.querySelectorAll('input[name=type]');
            for (i = 0; i < inputs.length; i++) {
                inputs[i].addEventListener('change', function(event) {
                    selectedPatch.node.type = event.target.value;
                });
            }
            pane.querySelector('input[name=frequency]').min = node.frequency.minValue;
            pane.querySelector('input[name=frequency]').max = node.frequency.maxValue;
            pane.querySelector('input[name=frequency]').addEventListener('change', function(event) {
                pane.querySelector('label[name=frequency]').innerText = event.target.value;
                selectedPatch.node.frequency.value = event.target.value;
            });
            pane.querySelector('input[name=detune]').min = node.detune.minValue;
            pane.querySelector('input[name=detune]').max = node.detune.maxValue;
            pane.querySelector('input[name=detune]').addEventListener('change', function(event) {
                pane.querySelector('label[name=detune]').innerText = event.target.value;
                selectedPatch.node.detune.value = event.target.value;
            });
            pane.querySelector('input[name=Q]').min = node.Q.minValue * Q_SCALE;
            pane.querySelector('input[name=Q]').max = node.Q.maxValue * Q_SCALE;
            pane.querySelector('input[name=Q]').addEventListener('change', function(event) {
                selectedPatch.node.Q.value = event.target.value / Q_SCALE;
            });
            pane.querySelector('input[name=gain]').min = node.gain.minValue;
            pane.querySelector('input[name=gain]').max = node.gain.maxValue;
            pane.querySelector('input[name=gain]').addEventListener('change', function(event) {
                selectedPatch.node.gain.value = event.target.value;
            });
        }
        function convolver() {
            var i, inputs, node;
            node = nodeSpec.Convolver.build();
            inputs = document.querySelectorAll('#convolverParams input[name=normalize]');
            for (i = 0; i < inputs.length; i++) {
                inputs[i].addEventListener('change', function(event) {
                    selectedPatch.node.normalize = event.target.value === 'true';
                    selectedPatch.node.buffer = impulseResponse(4,4,false);
                });
            }
        }
        function delay() {
            var node, pane;
            node = nodeSpec.Delay.build();
            pane = document.querySelector('#' + nodeSpec.Delay.label + 'Params');
            pane.querySelector('input[name=delayTime]').min = node.delayTime.minValue * DELAY_TIME_SCALE;
            pane.querySelector('input[name=delayTime]').max = node.delayTime.maxValue * DELAY_TIME_SCALE;
            pane.querySelector('input[name=delayTime]').addEventListener('change', function(event) {
                pane.querySelector('label[name=delayTime]').innerText = event.target.value / DELAY_TIME_SCALE;
                selectedPatch.node.delayTime.value = event.target.value / DELAY_TIME_SCALE;
            });
        }
        function compress() {
            var node, pane;
            node = nodeSpec.DynamicsCompressor.build();
            pane = document.querySelector('#' + nodeSpec.DynamicsCompressor.label + 'Params');
            pane.querySelector('input[name=threshold]').min = node.threshold.minValue;
            pane.querySelector('input[name=threshold]').max = node.threshold.maxValue;
            pane.querySelector('input[name=threshold]').addEventListener('change', function(event) {
                pane.querySelector('label[name=threshold]').innerText = event.target.value;
                selectedPatch.node.threshold.value = event.target.value;
            });
            pane.querySelector('input[name=knee]').min = node.knee.minValue;
            pane.querySelector('input[name=knee]').max = node.knee.maxValue;
            pane.querySelector('input[name=knee]').addEventListener('change', function(event) {
                pane.querySelector('label[name=knee]').innerText = event.target.value;
                selectedPatch.node.knee.value = event.target.value;
            });
            pane.querySelector('input[name=ratio]').min = node.ratio.minValue;
            pane.querySelector('input[name=ratio]').max = node.ratio.maxValue;
            pane.querySelector('input[name=ratio]').addEventListener('change', function(event) {
                pane.querySelector('label[name=ratio]').innerText = event.target.value;
                selectedPatch.node.ratio.value = event.target.value;
            });
            pane.querySelector('input[name=reduction]').min = node.reduction.minValue;
            pane.querySelector('input[name=reduction]').max = node.reduction.maxValue;
            pane.querySelector('input[name=reduction]').addEventListener('change', function(event) {
                selectedPatch.node.reduction.value = event.target.value;
            });
            pane.querySelector('input[name=attack]').min = node.attack.minValue * ATTACK_SCALE;
            pane.querySelector('input[name=attack]').max = node.attack.maxValue * ATTACK_SCALE;
            pane.querySelector('input[name=attack]').addEventListener('change', function(event) {
                pane.querySelector('label[name=attack]').innerText = event.target.value / ATTACK_SCALE;
                selectedPatch.node.attack.value = event.target.value / ATTACK_SCALE;
            });
            pane.querySelector('input[name=release]').min = node.release.minValue * RELEASE_SCALE;
            pane.querySelector('input[name=release]').max = node.release.maxValue * RELEASE_SCALE;
            pane.querySelector('input[name=release]').addEventListener('change', function(event) {
                pane.querySelector('label[name=release]').innerText = event.target.value / RELEASE_SCALE;
                selectedPatch.node.release.value = event.target.value / RELEASE_SCALE;
            });
        }
        function shaper() {
            var node, i, inputs;
            node = nodeSpec.WaveShaper.build();
            inputs = document.querySelectorAll('#shaperParams input[name=oversample]');
            for (i = 0; i < inputs.length; i++) {
                inputs[i].addEventListener('change', function(event) {
                    selectedPatch.node.oversample = event.target.value;
                });
            }
        }
        function audioDestination() {
            document.querySelector('#destParams label[name=maxChannelCount]').innerText = audioContext.destination.maxChannelCount;
        }

        oscillator();
        audioBuffer();
        gain();
        biquadFilter();
        convolver();
        delay();
        compress();
        shaper();
        audioDestination();
    }

    function refreshPane(patch) {
        var pane = document.querySelector('#' + nodeSpec[patch.nodeType].label + 'Params');
        if (patch.nodeType === 'Oscillator') {
            pane.querySelector('input[value=' + patch.node.type + ']').checked = 'checked';
            pane.querySelector('input[name=frequency]').value = patch.node.frequency.value;
            pane.querySelector('label[name=frequency]').innerText = patch.node.frequency.value;
            pane.querySelector('input[name=detune]').value = patch.node.detune.value;
            pane.querySelector('label[name=detune]').innerText = patch.node.detune.value;
        } else if (patch.nodeType === 'AudioBufferSource') {
            pane.querySelector('label[name=playbackRate]').innerText = patch.node.playbackRate.value;
            pane.querySelector('input[name=playbackRate]').value = patch.node.playbackRate.value * PLAYBACK_RATE_SCALE;
        } else if (patch.nodeType === 'Gain') {
            pane.querySelector('input[name=gain]').value = patch.node.gain.value * GAIN_SCALE;
        } else if (patch.nodeType === 'BiquadFilter') {
            pane.querySelector('input[value=' + patch.node.type + ']').checked = 'checked';
            pane.querySelector('input[name=frequency]').value = patch.node.frequency.value;
            pane.querySelector('label[name=frequency]').innerText = patch.node.frequency.value;
            pane.querySelector('input[name=detune]').value = patch.node.detune.value;
            pane.querySelector('label[name=detune]').innerText = patch.node.detune.value;
            pane.querySelector('input[name=Q]').value = patch.node.Q.value * Q_SCALE;
            pane.querySelector('input[name=gain]').value = patch.node.gain.value;
        } else if (patch.nodeType === 'Convolver') {
            pane.querySelector('input[value=' + patch.node.normalize + ']').checked = 'checked';
        } else if (patch.nodeType === 'Delay') {
            pane.querySelector('input[name=delayTime]').value = patch.node.delayTime.value * DELAY_TIME_SCALE;
            pane.querySelector('label[name=delayTime]').innerText = patch.node.delayTime.value;
        } else if (patch.nodeType === 'DynamicsCompressor') {
            pane.querySelector('input[name=threshold]').value = patch.node.threshold.value;
            pane.querySelector('label[name=threshold]').innerText = patch.node.threshold.value;
            pane.querySelector('input[name=knee]').value = patch.node.knee.value;
            pane.querySelector('label[name=knee]').innerText = patch.node.knee.value;
            pane.querySelector('input[name=ratio]').value = patch.node.ratio.value;
            pane.querySelector('label[name=ratio]').innerText = patch.node.ratio.value;
            pane.querySelector('input[name=reduction]').value = patch.node.reduction.value;
            pane.querySelector('input[name=attack]').value = patch.node.attack.value * ATTACK_SCALE;
            pane.querySelector('label[name=attack]').innerText = patch.node.attack.value;
            pane.querySelector('input[name=release]').value = patch.node.release.value * RELEASE_SCALE;
            pane.querySelector('label[name=release]').innerText = patch.node.release.value;
        } else if (patch.nodeType === 'WaveShaper') {
            pane.querySelector('input[value=\'' + patch.node.oversample + '\']').checked = 'checked';
        }
    }

    setupStage();
    setupViews();
})();
