; Windows installer of Plastimax F.R. (Inno Setup 6). desktop\build.mjs compiles it:
;   ISCC.exe /DVersion=1.0.0 /DOrigen=<packaged folder> /O<output folder> desktop\installer.iss
;
; It installs per user, with no administrator prompt, in %LOCALAPPDATA%\Programs. Running a newer Setup over it
; UPDATES: same AppId, it closes the app if it is open and replaces the files. Nothing of the store lives in the
; program's folder (the local copy of the data and the signed-in session are in %APPDATA%\Plastimax F.R.), so
; neither updating nor uninstalling touches them.

#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef Origen
  #error Falta /DOrigen=<carpeta empaquetada>
#endif
#define Nombre "Plastimax F.R."
#define Exe "Plastimax.exe"

[Setup]
; Fixed for good: it is what tells Windows that a new Setup is an update of this program and not another one.
AppId={{4F8C8E5F-63EE-42BD-B993-F7CA6A4A5990}
AppName={#Nombre}
AppVersion={#Version}
AppVerName={#Nombre} {#Version}
AppPublisher=Plastimax F.R.
DefaultDirName={autopf}\Plastimax
DefaultGroupName={#Nombre}
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=Plastimax-FR-{#Version}-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#Exe}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; The app of the previous version is not mixed with the new one's.
Type: filesandordirs; Name: "{app}\resources"

[Files]
Source: "{#Origen}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#Nombre}"; Filename: "{app}\{#Exe}"
Name: "{autodesktop}\{#Nombre}"; Filename: "{app}\{#Exe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#Exe}"; Description: "{cm:LaunchProgram,{#StringChange(Nombre, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
