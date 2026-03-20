const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
// NW.js 项目中 __dirname 指向应用根目录
const appDir = process.cwd();
// 全局变量
let currentChildProcess = null;
let isRunning = false;
// DOM 元素引用
const inputGuid = document.getElementById('inputGuid');
const convertBtn = document.getElementById('convertBtn');
const stopBtn = document.getElementById('stopBtn');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const logOutput = document.getElementById('logOutput');
// 日志输出函数
function log(message, type = 'info') {
    const line = document.createElement('div');
    line.className = `log-line log-${type}`;
    const timestamp = new Date().toLocaleTimeString();
    line.textContent = `[${timestamp}] ${message}`;
    logOutput.appendChild(line);
    logOutput.scrollTop = logOutput.scrollHeight;
}
// 清空日志
function clearLog() {
    logOutput.innerHTML = '';
}
// 更新状态
function updateStatus(status, text) {
    statusIndicator.className = 'status-indicator ' + status;
    statusText.textContent = text;
}
// 更新进度条
function updateProgress(percent, text) {
    progressFill.style.width = percent + '%';
    progressText.textContent = text;
}
// 显示/隐藏进度条
function showProgress(show) {
    if (show) {
        progressContainer.classList.add('active');
    } else {
        progressContainer.classList.remove('active');
    }
}
// 设置按钮状态
function setButtonState(running) {
    isRunning = running;
    convertBtn.disabled = running;
    stopBtn.disabled = !running;
}
// 停止当前进程
function stopProcess() {
    if (currentChildProcess) {
        log('正在停止进程...', 'warn');
        currentChildProcess.kill('SIGTERM');
        currentChildProcess = null;
    }
    const guid = inputGuid.value.trim();
    const testDir = path.join(appDir, guid);
    if (!fs.existsSync(testDir)) {
        log('中间目录不存在，跳过清理步骤', 'info');
    } else {
		let deletedTsCount = 0;
		let tmpFiles = fs.readdirSync(testDir);
		for (const file of tmpFiles) {
			try {
				fs.unlinkSync(path.join(testDir, file));
				deletedTsCount++;
			} catch (err) {
				log(`无法删除文件 ${file}: ${err.message}`, 'warn');
			}
		}
		fs.rmdirSync(testDir);
		log(`已删除中间文件: ${deletedTsCount} 个`, 'success');
    }
    setButtonState(false);
    updateStatus('error', '已停止');
    showProgress(false);
}
// 主函数
async function main(guid) {
    const cdn = "dh5.cntv.qcloudcdn.com";
    const m3u8Url = `https://${cdn}/asp/h5e/hls/2000/0303000a/3/default/${guid}/2000.m3u8`;
    log(`开始处理 GUID: ${guid}`, 'info');
    log(`M3U8 地址: ${m3u8Url}`, 'info');
    const testDir = path.join(appDir, guid);
    fs.mkdirSync(testDir, { recursive: true });
    log(`创建工作目录: ${testDir}`, 'info');
    const tsPrefix = path.join(testDir, '%04d.ts');
    const ffmpegPath = path.join(appDir, 'ffmpeg.exe');
    updateProgress(10, '正在下载视频片段...');
    return new Promise((resolve, reject) => {
        const ffc = spawn(ffmpegPath, [
            '-hide_banner', '-nostats',
            '-v', 'panic',
            '-i', `${m3u8Url}`,
            '-c', 'copy',
            '-f', 'segment',
            '-segment_time', '10',
            '-segment_format', 'mpegts',
            '-segment_list', guid + '/list.txt',
            '-segment_list_type', '4',
            '-y', `${tsPrefix}`
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            cwd: appDir
        });
        currentChildProcess = ffc;
        // 捕获 ffmpeg 输出
        ffc.stdout.on('data', (data) => {
            log(data.toString().trim(), 'info');
        });
        ffc.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) log(msg, 'info');
        });
        ffc.on('error', (err) => {
            if (err.code === 'ENOENT') {
                log('错误: 未找到 ffmpeg.exe，请确保已安装 ffmpeg', 'error');
            } else {
                log('启动失败: ' + err.message, 'error');
            }
            reject(err);
        });
        ffc.on('close', (code) => {
            currentChildProcess = null;
            log(`下载进程退出，代码: ${code}`, code === 0 ? 'success' : 'warn');
            if (code === 0) {
                resolve();
            } else if (code !== null) {
                reject(new Error(`进程异常退出，代码: ${code}`));
            }
        });
    });
}
// 解密函数
async function decryptTsFiles(guid) {
    const testDir = path.join(appDir, guid);
    if (!fs.existsSync(testDir)) {
        throw new Error(`目标文件夹 ${testDir} 不存在`);
    }
    const finalOutput = path.join(testDir, `${guid}.mp4`);
    const scriptPath = path.join(appDir, 'dec.mjs');
    const scriptArgs = [path.join(testDir, 'list.txt'), finalOutput];
    const nodePath = path.join(appDir, 'node.exe');
    updateProgress(50, '正在解密合并视频...');
    log('开始解密合并...', 'info');
    return new Promise((resolve, reject) => {
        // 使用 spawn 调用 node.exe 执行脚本
        const child = spawn(nodePath, [scriptPath, ...scriptArgs], {
            cwd: appDir,
            stdio: 'inherit'
        });
        currentChildProcess = child;
        child.on('close', (code) => {
            currentChildProcess = null;
            if (code !== 0) {
                log(`解密失败 (退出码: ${code})`, 'error');
                resolve(); // 继续执行
            } else {
                log(`输出文件: ${finalOutput}`, 'success');
                resolve();
            }
        });
        child.on('error', (err) => {
            currentChildProcess = null;
            log('启动解密进程失败: ' + err.message, 'error');
            resolve();
        });
    });
}
// 清理中间文件
async function cleanupIntermediateFiles(guid) {
    const testDir = path.join(appDir, guid);
    if (!fs.existsSync(testDir)) {
        log('中间目录不存在，跳过清理步骤', 'info');
        return;
    }
    updateProgress(80, '正在清理中间文件...');
    log('开始清理中间文件...', 'info');
    let deletedTsCount = 0;
    let tsFiles = fs.readdirSync(testDir).filter(file => file.endsWith('.ts'));
    tsFiles.push("list.txt");
    for (const file of tsFiles) {
        try {
            fs.unlinkSync(path.join(testDir, file));
            deletedTsCount++;
        } catch (err) {
            log(`无法删除文件 ${file}: ${err.message}`, 'warn');
        }
    }
    log(`已删除中间文件: ${deletedTsCount} 个`, 'success');
    const finalOutput = path.join(testDir, `${guid}.mp4`);
    const outDir = path.join(appDir, ".." ,"videos");
    fs.mkdirSync(outDir, { recursive: true });
    const api = `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?client=flash&im=0&pid=${guid}`;
    try {
        const response = await fetch(api);
        if (!response.ok) {
            throw new Error(`HTTP 错误! 状态码: ${response.status}`);
        }
        const json = await response.json();
        const orgtitle = json.title;
        const title = safeName(orgtitle);
        log(`视频标题: ${title}`, 'info');
        const dest = path.join(outDir, `${title}.mp4`);
        fs.renameSync(finalOutput, dest);
        log(`文件重命名为: ${title}.mp4`, 'success');
        log(`最终输出文件: ${dest}`, 'success');
    } catch (err) {
        log(`获取标题失败: ${err.message}`, 'warn');
        log(`使用原始GUID命名: ${guid}.mp4`, 'info');
        // 移动文件到 video 目录
        const dest = path.join(outDir, `${guid}.mp4`);
        fs.renameSync(finalOutput, dest);
        log(`最终输出文件: ${dest}`, 'success');
    }
    const remainingFiles = fs.readdirSync(testDir);
    if (remainingFiles.length === 0) {
        try {
            fs.rmdirSync(testDir);
            log('中间目录已删除', 'info');
        } catch (err) {
            log(`无法删除中间目录: ${err.message}`, 'warn');
        }
    } else {
        log(`中间目录中还有 ${remainingFiles.length} 个文件`, 'info');
    }
}
// 安全文件名函数
function safeName(title) {
    const maxLength = 150;
    const allowedPattern = new RegExp(
        '[^' +
        '\\u002D' + '\\u005F' + // - _
        '\\u0030-\\u0039' + // 0-9
        '\\u0041-\\u005A' + // A-Z
        '\\u0061-\\u007A' + // a-z
        '\\u4E00-\\u9FFF' + // CJK 汉字
        ']',
        'g'
    );
    let safe = title.replace(allowedPattern, '_');
    safe = safe.trim().replace(/^\.+|\.+$/g, '');
    if (!safe || /^_+$/.test(safe)) safe = 'video';
    if (safe.length > maxLength) safe = safe.substring(0, maxLength);
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(safe)) {
        safe = '_' + safe;
    }
    return safe;
}
// 开始下载
async function startDownload() {
    const guid = inputGuid.value.trim();
    if (!guid) {
        log('请输入有效的 GUID', 'error');
        updateStatus('error', '请输入 GUID');
        return;
    }
    // 验证 GUID 格式
    if (!/^[a-fA-F0-9]{32}$/.test(guid)) {
        log('GUID 格式不正确，应为32位十六进制字符', 'warn');
    }
    clearLog();
    setButtonState(true);
    showProgress(true);
    updateProgress(0, '准备中...');
    updateStatus('running', '正在下载...');
    const startTime = Date.now();
    try {
        await main(guid);
        updateProgress(50, '下载完成，正在处理...');
        await decryptTsFiles(guid);
        updateProgress(80, '解密完成，正在清理...');
        await cleanupIntermediateFiles(guid);
        updateProgress(100, '完成！');
        const totalTime = (Date.now() - startTime) / 1000;
        log(`所有任务完成！总耗时: ${totalTime.toFixed(2)} 秒`, 'success');
        updateStatus('success', '下载完成');
    } catch (err) {
        log(`流程失败: ${err.message || err}`, 'error');
        updateStatus('error', '下载失败');
    } finally {
        setButtonState(false);
        currentChildProcess = null;
    }
}
// 绑定事件
convertBtn.addEventListener('click', startDownload);
stopBtn.addEventListener('click', stopProcess);
// 回车键触发下载
inputGuid.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !isRunning) {
        startDownload();
    }
});
// 初始化状态
updateStatus('', '等待输入...');
log('CCTV 视频下载器已就绪', 'info');
